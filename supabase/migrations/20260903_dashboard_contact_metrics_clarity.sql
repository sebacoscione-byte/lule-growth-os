-- ============================================================
-- Dashboard: métricas de contacto coherentes con el período visible.
--
-- 1) Un intento de pedir turno es abrir turno online, teléfono o WhatsApp.
--    "Cómo llegar" se conserva como acción separada, pero no infla ese indicador.
-- 2) Los totales por botón reciben los rangos exactos del dashboard. Esto evita
--    mezclar el fin de semana anterior con la semana calendario lunes-hoy.
-- 3) Todos los resultados siguen siendo agregados anónimos.
-- ============================================================

create or replace function dashboard_growth_timeseries(p_days int default 30)
returns table(
  metric_date date,
  visits bigint,
  engaged_visits bigint,
  contact_actions bigint,
  leads bigint,
  confirmed bigint
)
language sql
stable
as $$
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 365)) as days
  ),
  calendar as (
    select generate_series(
      current_date - ((select days from params) * 2 - 1),
      current_date,
      interval '1 day'
    )::date as metric_date
  ),
  event_daily as (
    select
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp')) as engaged_visits,
      count(*) filter (
        where event_type in ('click_booking', 'click_call', 'click_whatsapp')
      ) as contact_actions
    from landing_events
    where timezone('America/Argentina/Buenos_Aires', created_at)::date >=
      current_date - ((select days from params) * 2 - 1)
    group by 1
  ),
  lead_daily as (
    select
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date,
      count(*) as leads,
      count(*) filter (where confirmed_booked) as confirmed
    from leads
    where timezone('America/Argentina/Buenos_Aires', created_at)::date >=
      current_date - ((select days from params) * 2 - 1)
    group by 1
  )
  select
    calendar.metric_date,
    coalesce(event_daily.visits, 0),
    least(coalesce(event_daily.visits, 0), coalesce(event_daily.engaged_visits, 0)),
    coalesce(event_daily.contact_actions, 0),
    coalesce(lead_daily.leads, 0),
    coalesce(lead_daily.confirmed, 0)
  from calendar
  left join event_daily using (metric_date)
  left join lead_daily using (metric_date)
  order by calendar.metric_date;
$$;

create or replace function dashboard_action_totals(
  p_start date,
  p_end date,
  p_previous_start date,
  p_previous_end date
)
returns table(event_type text, actions bigint, previous_actions bigint, engaged_visits bigint)
language sql
stable
as $$
  select
    landing_events.event_type,
    count(*) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
    ) as actions,
    count(*) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_previous_start, p_previous_end) and greatest(p_previous_start, p_previous_end)
    ) as previous_actions,
    count(distinct coalesce(session_id::text, id::text)) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
    ) as engaged_visits
  from landing_events
  where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
    and timezone('America/Argentina/Buenos_Aires', created_at)::date
      between least(p_previous_start, p_start, p_end, p_previous_end)
          and greatest(p_previous_start, p_start, p_end, p_previous_end)
  group by landing_events.event_type;
$$;

drop function if exists dashboard_site_journey(date, date);

create function dashboard_site_journey(p_start date, p_end date)
returns table(
  source text,
  medium text,
  campaign text,
  content text,
  visits bigint,
  active_visits bigint,
  hero_visits bigint,
  booking_options_visits bigint,
  hero_booking_visits bigint,
  contact_visits bigint,
  booking_visits bigint,
  call_visits bigint,
  whatsapp_visits bigint,
  maps_visits bigint,
  instagram_visits bigint
)
language sql
stable
as $$
  with normalized as (
    select
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        else lower(trim(utm_source))
      end as source,
      coalesce(nullif(lower(trim(utm_medium)), ''), 'sin_medium') as medium,
      coalesce(nullif(lower(trim(utm_campaign)), ''), 'sin_campana') as campaign,
      coalesce(nullif(lower(trim(utm_content)), ''), 'sin_contenido') as content,
      event_type,
      coalesce(nullif(lower(trim(variant)), ''), 'a') as variant,
      coalesce(session_id::text, id::text) as visit_key
    from landing_events
    where timezone('America/Argentina/Buenos_Aires', created_at)::date
      between least(p_start, p_end) and greatest(p_start, p_end)
  )
  select
    source,
    medium,
    campaign,
    content,
    count(distinct visit_key) filter (where event_type = 'page_view') as visits,
    count(distinct visit_key) filter (where event_type <> 'page_view') as active_visits,
    count(distinct visit_key) filter (
      where event_type in ('view_booking_options', 'click_hero_primary', 'click_hero_secondary')
    ) as hero_visits,
    count(distinct visit_key) filter (where event_type = 'view_booking_options') as booking_options_visits,
    count(distinct visit_key) filter (
      where (event_type = 'click_hero_primary' and variant = 'a')
         or (event_type = 'click_hero_secondary' and variant = 'b')
    ) as hero_booking_visits,
    count(distinct visit_key) filter (
      where event_type in ('click_booking', 'click_call', 'click_whatsapp')
    ) as contact_visits,
    count(distinct visit_key) filter (where event_type = 'click_booking') as booking_visits,
    count(distinct visit_key) filter (where event_type = 'click_call') as call_visits,
    count(distinct visit_key) filter (where event_type = 'click_whatsapp') as whatsapp_visits,
    count(distinct visit_key) filter (where event_type = 'click_maps') as maps_visits,
    count(distinct visit_key) filter (where event_type = 'click_instagram') as instagram_visits
  from normalized
  group by source, medium, campaign, content
  order by visits desc, contact_visits desc;
$$;

create or replace function dashboard_campaign_performance(p_start date, p_end date)
returns table(
  source text,
  medium text,
  campaign text,
  content text,
  visits bigint,
  engaged_visits bigint,
  leads bigint,
  confirmed bigint,
  first_seen date,
  last_seen date
)
language sql
stable
as $$
  with normalized_events as (
    select
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        else lower(trim(utm_source))
      end as source,
      coalesce(nullif(lower(trim(utm_medium)), ''), 'sin_medium') as medium,
      lower(trim(utm_campaign)) as campaign,
      coalesce(nullif(lower(trim(utm_content)), ''), 'sin_contenido') as content,
      event_type,
      coalesce(session_id::text, id::text) as visit_key,
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date
    from landing_events
    where nullif(trim(utm_campaign), '') is not null
      and timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
  ),
  event_totals as (
    select
      source,
      medium,
      campaign,
      content,
      count(distinct visit_key) filter (where event_type = 'page_view') as visits,
      count(distinct visit_key) filter (
        where event_type in ('click_booking', 'click_call', 'click_whatsapp')
      ) as engaged_visits,
      min(metric_date) as first_seen,
      max(metric_date) as last_seen
    from normalized_events
    group by source, medium, campaign, content
  ),
  normalized_leads as (
    select
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is not null then lower(trim(utm_source))
        when origin_channel is not null then origin_channel::text
        else 'direct'
      end as source,
      coalesce(nullif(lower(trim(utm_medium)), ''), 'sin_medium') as medium,
      lower(trim(coalesce(nullif(utm_campaign, ''), origin_campaign))) as campaign,
      coalesce(nullif(lower(trim(utm_content)), ''), 'sin_contenido') as content,
      confirmed_booked,
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date
    from leads
    where nullif(trim(coalesce(utm_campaign, origin_campaign)), '') is not null
      and timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
  ),
  lead_totals as (
    select
      source,
      medium,
      campaign,
      content,
      count(*) as leads,
      count(*) filter (where confirmed_booked) as confirmed,
      min(metric_date) as first_seen,
      max(metric_date) as last_seen
    from normalized_leads
    group by source, medium, campaign, content
  )
  select
    coalesce(event_totals.source, lead_totals.source),
    coalesce(event_totals.medium, lead_totals.medium),
    coalesce(event_totals.campaign, lead_totals.campaign),
    coalesce(event_totals.content, lead_totals.content),
    coalesce(event_totals.visits, 0),
    least(coalesce(event_totals.visits, 0), coalesce(event_totals.engaged_visits, 0)),
    coalesce(lead_totals.leads, 0),
    coalesce(lead_totals.confirmed, 0),
    least(event_totals.first_seen, lead_totals.first_seen),
    greatest(event_totals.last_seen, lead_totals.last_seen)
  from event_totals
  full outer join lead_totals using (source, medium, campaign, content)
  order by coalesce(lead_totals.confirmed, 0) desc,
           coalesce(lead_totals.leads, 0) desc,
           coalesce(event_totals.engaged_visits, 0) desc,
           coalesce(event_totals.visits, 0) desc;
$$;

create or replace function dashboard_content_performance(p_start date, p_end date)
returns table(item_id text, visits bigint, engaged_visits bigint)
language sql
stable
as $$
  with totals as (
    select
      utm_content as item_id,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp')) as engaged
    from landing_events
    where utm_source = 'instagram'
      and utm_content is not null
      and timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
    group by utm_content
  )
  select item_id, visits, least(visits, engaged) as engaged_visits
  from totals
  order by engaged_visits desc, visits desc;
$$;

revoke all on function dashboard_action_totals(date, date, date, date) from public, anon;
grant execute on function dashboard_action_totals(date, date, date, date) to authenticated;
revoke all on function dashboard_site_journey(date, date) from public, anon;
grant execute on function dashboard_site_journey(date, date) to authenticated;
revoke all on function dashboard_campaign_performance(date, date) from public, anon;
grant execute on function dashboard_campaign_performance(date, date) to authenticated;
revoke all on function dashboard_content_performance(date, date) from public, anon;
grant execute on function dashboard_content_performance(date, date) to authenticated;
