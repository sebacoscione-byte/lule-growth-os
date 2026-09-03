-- Ranking de páginas alineado con el período calendario visible en el dashboard.
-- “Cómo llegar” sigue medido en su bloque propio y no infla la intención de pedir turno.
create or replace function landing_events_ranking(p_start date, p_end date)
returns table(slug text, visits bigint, interactions bigint)
language sql
stable
as $$
  with totals as (
    select
      landing_events.slug,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type = 'page_view') as visits,
      count(distinct coalesce(session_id::text, id::text))
        filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp')) as engaged
    from landing_events
    where timezone('America/Argentina/Buenos_Aires', created_at)::date
        between least(p_start, p_end) and greatest(p_start, p_end)
      and event_type in ('page_view', 'click_booking', 'click_call', 'click_whatsapp')
    group by landing_events.slug
  )
  select totals.slug, totals.visits, least(totals.visits, totals.engaged) as interactions
  from totals;
$$;

revoke all on function landing_events_ranking(date, date) from public, anon;
grant execute on function landing_events_ranking(date, date) to authenticated;
