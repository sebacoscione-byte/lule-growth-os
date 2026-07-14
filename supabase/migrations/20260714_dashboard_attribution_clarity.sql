-- ============================================================
-- Dashboard: normalizacion de canales + embudo por landing
--
-- 1) `ig` e `instagram` representan el mismo canal y deben agregarse antes de contar sesiones.
-- 2) El contenido historico de Instagram tambien puede usar cualquiera de los dos aliases.
-- 3) El embudo de referencia cuenta sesiones unicas, no recargas/clicks repetidos de una pestaña.
-- ============================================================

create or replace function dashboard_channel_performance(p_days int default 30)
returns table(
  channel text,
  visits bigint,
  previous_visits bigint,
  leads bigint,
  previous_leads bigint,
  confirmed bigint,
  previous_confirmed bigint
)
language sql
stable
as $$
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 365)) as days
  ),
  event_rows as (
    select
      case
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        else lower(trim(utm_source))
      end as channel,
      coalesce(session_id::text, id::text) as visit_key,
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date
    from landing_events
    where event_type = 'page_view'
      and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - ((select days from params) * 2 - 1)
  ),
  event_totals as (
    select
      channel,
      count(distinct visit_key) filter (
        where metric_date >= current_date - (select days from params) + 1
      ) as visits,
      count(distinct visit_key) filter (
        where metric_date between
          current_date - ((select days from params) * 2) + 1
          and current_date - (select days from params)
      ) as previous_visits
    from event_rows
    group by channel
  ),
  lead_rows as (
    select
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is not null then lower(trim(utm_source))
        when origin_channel is not null then origin_channel::text
        else 'direct'
      end as channel,
      confirmed_booked,
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date
    from leads
    where timezone('America/Argentina/Buenos_Aires', created_at)::date >=
      current_date - ((select days from params) * 2 - 1)
  ),
  lead_totals as (
    select
      channel,
      count(*) filter (
        where metric_date >= current_date - (select days from params) + 1
      ) as leads,
      count(*) filter (
        where metric_date between
          current_date - ((select days from params) * 2) + 1
          and current_date - (select days from params)
      ) as previous_leads,
      count(*) filter (
        where metric_date >= current_date - (select days from params) + 1 and confirmed_booked
      ) as confirmed,
      count(*) filter (
        where metric_date between
          current_date - ((select days from params) * 2) + 1
          and current_date - (select days from params)
          and confirmed_booked
      ) as previous_confirmed
    from lead_rows
    group by channel
  ),
  channels as (
    select channel from event_totals
    union
    select channel from lead_totals
  )
  select
    channels.channel,
    coalesce(event_totals.visits, 0),
    coalesce(event_totals.previous_visits, 0),
    coalesce(lead_totals.leads, 0),
    coalesce(lead_totals.previous_leads, 0),
    coalesce(lead_totals.confirmed, 0),
    coalesce(lead_totals.previous_confirmed, 0)
  from channels
  left join event_totals using (channel)
  left join lead_totals using (channel)
  order by coalesce(lead_totals.confirmed, 0) desc,
           coalesce(lead_totals.leads, 0) desc,
           coalesce(event_totals.visits, 0) desc;
$$;

create or replace function dashboard_content_performance(p_days int default 30)
returns table(item_id text, visits bigint, engaged_visits bigint)
language sql
stable
as $$
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 365)) as days
  ),
  totals as (
    select
      utm_content as item_id,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as engaged
    from landing_events
    where lower(trim(utm_source)) in ('ig', 'insta', 'instagram')
      and utm_content is not null
      and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
    group by utm_content
  )
  select item_id, visits, least(visits, engaged) as engaged_visits
  from totals
  order by engaged_visits desc, visits desc;
$$;

create or replace function landing_referral_events(p_days int default 90)
returns table (slug text, location_key text, event_type text, event_count bigint)
language sql
stable
as $$
  select
    landing_events.slug,
    landing_events.location_key,
    landing_events.event_type,
    count(distinct coalesce(landing_events.session_id::text, landing_events.id::text)) as event_count
  from landing_events
  where landing_events.created_at >= now() - (greatest(1, least(coalesce(p_days, 90), 365)) || ' days')::interval
    and landing_events.event_type in ('page_view', 'click_whatsapp')
  group by landing_events.slug, landing_events.location_key, landing_events.event_type;
$$;

grant execute on function dashboard_channel_performance(int) to authenticated;
grant execute on function dashboard_content_performance(int) to authenticated;
grant execute on function landing_referral_events(int) to authenticated;
