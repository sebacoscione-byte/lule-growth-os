-- ============================================================
-- Dashboard: atribución por campaña UTM.
--
-- Mantiene separados los datos propios (visita -> acción -> lead -> turno) de las métricas
-- publicitarias de Meta. La función sólo devuelve agregados y nunca expone datos del paciente.
-- Las dimensiones se normalizan antes de agrupar para que aliases históricos de Instagram no
-- fragmenten una misma campaña.
-- ============================================================

create index if not exists landing_events_campaign_period_idx
  on landing_events (utm_campaign, utm_source, utm_medium, utm_content, created_at desc)
  where utm_campaign is not null;

create index if not exists leads_campaign_period_idx
  on leads (utm_campaign, utm_source, utm_medium, utm_content, created_at desc)
  where utm_campaign is not null;

create or replace function dashboard_campaign_performance(p_days int default 30)
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
  with params as (
    select greatest(7, least(coalesce(p_days, 30), 365)) as days
  ),
  normalized_events as (
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
      and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
  ),
  event_totals as (
    select
      source,
      medium,
      campaign,
      content,
      count(distinct visit_key) filter (where event_type = 'page_view') as visits,
      count(distinct visit_key) filter (
        where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
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
      and timezone('America/Argentina/Buenos_Aires', created_at)::date >=
        current_date - (select days from params) + 1
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
    coalesce(event_totals.source, lead_totals.source) as source,
    coalesce(event_totals.medium, lead_totals.medium) as medium,
    coalesce(event_totals.campaign, lead_totals.campaign) as campaign,
    coalesce(event_totals.content, lead_totals.content) as content,
    coalesce(event_totals.visits, 0) as visits,
    least(
      coalesce(event_totals.visits, 0),
      coalesce(event_totals.engaged_visits, 0)
    ) as engaged_visits,
    coalesce(lead_totals.leads, 0) as leads,
    coalesce(lead_totals.confirmed, 0) as confirmed,
    least(event_totals.first_seen, lead_totals.first_seen) as first_seen,
    greatest(event_totals.last_seen, lead_totals.last_seen) as last_seen
  from event_totals
  full outer join lead_totals using (source, medium, campaign, content)
  order by coalesce(lead_totals.confirmed, 0) desc,
           coalesce(lead_totals.leads, 0) desc,
           coalesce(event_totals.engaged_visits, 0) desc,
           coalesce(event_totals.visits, 0) desc;
$$;

revoke all on function dashboard_campaign_performance(int) from public, anon;
grant execute on function dashboard_campaign_performance(int) to authenticated;
