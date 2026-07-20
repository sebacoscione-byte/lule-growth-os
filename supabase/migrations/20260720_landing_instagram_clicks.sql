-- ============================================================
-- Migración: conteo agregado de clicks al link de confianza de Instagram (click_instagram)
--
-- El PR #104 (2026-07-16) agregó un link de confianza a Instagram en las 7 landings públicas y
-- trackea el click como `click_instagram` en landing_events -- pero a propósito no se sumó al
-- IN-list de "acciones de contacto/engaged" que usan las funciones de dashboard_growth_metrics (no
-- es un paso hacia pedir turno, mezclarlo ahí infla la tasa de conversión de forma engañosa). El
-- dato ya se graba desde esa fecha, pero hoy no se ve en ningún lado de /dashboard. Esta función,
-- separada a propósito de esas otras (mismo motivo de arriba), agrega el conteo total por período
-- -- mismo patrón simple de landing_clicks_by_location.
-- ============================================================

create or replace function landing_instagram_clicks(p_days int default 90)
returns bigint
language sql
stable
as $$
  select count(*)
  from landing_events
  where created_at >= now() - (p_days || ' days')::interval
    and event_type = 'click_instagram';
$$;

grant execute on function landing_instagram_clicks(int) to authenticated;
