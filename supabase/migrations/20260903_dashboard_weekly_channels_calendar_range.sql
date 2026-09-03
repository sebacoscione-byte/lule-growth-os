-- Rendimiento por canal alineado con los rangos exactos que muestra y compara el dashboard.
create or replace function dashboard_channel_performance(
  p_start date,
  p_end date,
  p_previous_start date,
  p_previous_end date
)
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
  with event_rows as (
    select
      case
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        else lower(trim(utm_source))
      end as channel,
      coalesce(session_id::text, id::text) as visit_key,
      timezone('America/Argentina/Buenos_Aires', created_at)::date as metric_date
    from landing_events
    where event_type = 'page_view'
      and timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_previous_start, p_start, p_end, p_previous_end)
            and greatest(p_previous_start, p_start, p_end, p_previous_end)
  ),
  event_totals as (
    select
      channel,
      count(distinct visit_key) filter (
        where metric_date between least(p_start, p_end) and greatest(p_start, p_end)
      ) as visits,
      count(distinct visit_key) filter (
        where metric_date between least(p_previous_start, p_previous_end)
          and greatest(p_previous_start, p_previous_end)
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
    where timezone('America/Argentina/Buenos_Aires', created_at)::date
      between least(p_previous_start, p_start, p_end, p_previous_end)
          and greatest(p_previous_start, p_start, p_end, p_previous_end)
  ),
  lead_totals as (
    select
      channel,
      count(*) filter (
        where metric_date between least(p_start, p_end) and greatest(p_start, p_end)
      ) as leads,
      count(*) filter (
        where metric_date between least(p_previous_start, p_previous_end)
          and greatest(p_previous_start, p_previous_end)
      ) as previous_leads,
      count(*) filter (
        where metric_date between least(p_start, p_end) and greatest(p_start, p_end)
          and confirmed_booked
      ) as confirmed,
      count(*) filter (
        where metric_date between least(p_previous_start, p_previous_end)
          and greatest(p_previous_start, p_previous_end)
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

revoke all on function dashboard_channel_performance(date, date, date, date) from public, anon;
grant execute on function dashboard_channel_performance(date, date, date, date) to authenticated;
