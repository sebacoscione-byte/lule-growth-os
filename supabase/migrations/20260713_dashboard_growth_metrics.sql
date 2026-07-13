-- ============================================================
-- Dashboard de crecimiento multicanal
--
-- 1) Identificador anonimo por sesion/pestana para medir visitas que interactuan sin contar cada
--    boton tocado como una persona distinta. No identifica al paciente y no se persiste en cookies.
-- 2) RPCs agregadas para evolucion temporal, comparacion contra el periodo anterior, canales y
--    acciones. Todo se agrega en Postgres: el dashboard no descarga eventos crudos.
-- 3) Snapshots diarios de insights de Instagram y Google, alimentados por el cron publish-content
--    ya existente (Vercel Hobby sigue en 2 crons).
-- ============================================================

-- `landing_events` existia antes del historial de migraciones en algunos entornos. La migracion
-- 20260620 usa `create table if not exists`, por lo que no agregaba estas columnas a esa tabla
-- historica. Declararlas aca mantiene este cambio autocontenido e idempotente.
alter table landing_events
  add column if not exists session_id uuid,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text;

-- Defensa equivalente para instalaciones historicas cuyo registro de migraciones y esquema real
-- pudieran no coincidir. Las columnas ya existen en instalaciones nuevas.
alter table leads
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text;

create index if not exists landing_events_session_id_idx on landing_events(session_id);
create index if not exists landing_events_created_type_session_idx
  on landing_events(created_at desc, event_type, session_id);
create index if not exists landing_events_utm_source_idx on landing_events(utm_source);

-- Mantiene la firma existente, pero "interactions" pasa a significar visitas que hicieron al
-- menos una accion. Para datos historicos sin session_id se limita al total de visitas para evitar
-- tasas imposibles mayores a 100%.
create or replace function landing_events_ranking(p_since timestamptz)
returns table(slug text, visits bigint, interactions bigint)
language sql
stable
as $$
  with totals as (
    select
      slug,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as engaged
    from landing_events
    where created_at >= p_since
      and event_type in ('page_view', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps')
    group by slug
  )
  select slug, visits, least(visits, engaged) as interactions
  from totals;
$$;

create or replace function landing_hero_variant_results(p_since timestamptz)
returns table(variant text, visits bigint, hero_primary_clicks bigint, hero_secondary_clicks bigint, interactions bigint)
language sql
stable
as $$
  with totals as (
    select
      variant,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(*) filter (where event_type = 'click_hero_primary') as hero_primary_clicks,
      count(*) filter (where event_type = 'click_hero_secondary') as hero_secondary_clicks,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as engaged
    from landing_events
    where slug = 'dra-lucia-chahin'
      and variant in ('a', 'b')
      and created_at >= p_since
      and event_type in (
        'page_view', 'click_hero_primary', 'click_hero_secondary',
        'click_booking', 'click_call', 'click_whatsapp', 'click_maps'
      )
    group by variant
  )
  select variant, visits, hero_primary_clicks, hero_secondary_clicks, least(visits, engaged)
  from totals;
$$;

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
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as engaged_visits,
      count(*) filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as contact_actions
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

create or replace function dashboard_action_totals(p_days int default 30)
returns table(event_type text, actions bigint, previous_actions bigint, engaged_visits bigint)
language sql
stable
as $$
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 365)) as days
  )
  select
    event_type,
    count(*) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
    ) as actions,
    count(*) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date between
        current_date - ((select days from params) * 2) + 1
        and current_date - (select days from params)
    ) as previous_actions,
    count(distinct coalesce(session_id::text, id::text)) filter (
      where timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
    ) as engaged_visits
  from landing_events
  where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
    and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
      current_date - ((select days from params) * 2 - 1)
  group by event_type;
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
    where utm_source = 'instagram'
      and utm_content is not null
      and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
    group by utm_content
  )
  select item_id, visits, least(visits, engaged) as engaged_visits
  from totals
  order by engaged_visits desc, visits desc;
$$;

alter table instagram_follower_snapshots
  add column if not exists reach int,
  add column if not exists profile_views int,
  add column if not exists link_taps int,
  add column if not exists total_interactions int;

create table if not exists google_business_snapshots (
  id uuid default uuid_generate_v4() primary key,
  captured_on date not null,
  rating numeric(2, 1),
  review_count int,
  impressions_search int,
  impressions_maps int,
  website_clicks int,
  call_clicks int,
  direction_requests int,
  performance_status text not null default 'pending'
    check (performance_status in ('available', 'quota_blocked', 'not_connected', 'pending', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists google_business_snapshots_captured_on_idx
  on google_business_snapshots(captured_on);

alter table google_business_snapshots enable row level security;

create policy "service_role_write_google_business_snapshots"
  on google_business_snapshots for all to service_role using (true) with check (true);

create policy "authenticated_read_google_business_snapshots"
  on google_business_snapshots for select to authenticated using (true);

grant execute on function landing_events_ranking(timestamptz) to authenticated;
grant execute on function landing_hero_variant_results(timestamptz) to authenticated;
grant execute on function dashboard_growth_timeseries(int) to authenticated;
grant execute on function dashboard_channel_performance(int) to authenticated;
grant execute on function dashboard_action_totals(int) to authenticated;
grant execute on function dashboard_content_performance(int) to authenticated;
