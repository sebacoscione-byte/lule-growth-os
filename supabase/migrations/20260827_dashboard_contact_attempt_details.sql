-- Drill-down privado del KPI "Intentaron contactarse".
-- Devuelve únicamente agregados anónimos por día, canal, sede y atribución UTM;
-- nunca expone session_id, IP ni datos identificatorios de pacientes.
create or replace function dashboard_contact_attempt_details(p_start date, p_end date)
returns table (
  event_date date,
  location_key text,
  event_type text,
  source text,
  medium text,
  campaign text,
  content text,
  sessions bigint
)
language sql
stable
as $$
  with contact_events as (
    select
      timezone('America/Argentina/Buenos_Aires', created_at)::date as event_date,
      coalesce(nullif(lower(trim(location_key)), ''), 'sin_sede') as location_key,
      landing_events.event_type,
      case
        when lower(trim(utm_source)) in ('ig', 'insta', 'instagram') then 'instagram'
        when nullif(lower(trim(utm_source)), '') is null then 'direct'
        else lower(trim(utm_source))
      end as source,
      coalesce(nullif(lower(trim(utm_medium)), ''), 'sin_medium') as medium,
      coalesce(nullif(lower(trim(utm_campaign)), ''), 'sin_campana') as campaign,
      coalesce(nullif(lower(trim(utm_content)), ''), 'sin_contenido') as content,
      coalesce(session_id::text, id::text) as visit_key
    from landing_events
    where timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
      and event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
  )
  select
    event_date,
    location_key,
    event_type,
    source,
    medium,
    campaign,
    content,
    count(distinct visit_key) as sessions
  from contact_events
  group by event_date, location_key, event_type, source, medium, campaign, content
  order by event_date desc, sessions desc, location_key, event_type;
$$;

revoke all on function dashboard_contact_attempt_details(date, date) from public, anon;
grant execute on function dashboard_contact_attempt_details(date, date) to authenticated;
