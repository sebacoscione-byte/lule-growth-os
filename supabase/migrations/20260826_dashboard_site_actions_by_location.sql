-- Desglose por sede alineado con el período calendario que muestra el dashboard.
create or replace function dashboard_site_actions_by_location(p_start date, p_end date)
returns table (location_key text, event_type text, event_count bigint)
language sql
stable
as $$
  select landing_events.location_key, landing_events.event_type, count(*) as event_count
  from landing_events
  where timezone('America/Argentina/Buenos_Aires', created_at)::date
      between least(p_start, p_end) and greatest(p_start, p_end)
    and event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')
    and location_key is not null
  group by landing_events.location_key, landing_events.event_type;
$$;

revoke all on function dashboard_site_actions_by_location(date, date) from public, anon;
grant execute on function dashboard_site_actions_by_location(date, date) to authenticated;
