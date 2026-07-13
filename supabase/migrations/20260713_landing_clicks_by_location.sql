-- ============================================================
-- Migración: clicks de "llamar"/"WhatsApp" agregados por sede (CIMEL/Swiss/Británico)
--
-- Hoy el dashboard tiene una card "Métricas de landings" que cuenta event_type = 'cta_cimel' /
-- 'cta_swiss' / 'cta_britanico' / 'form_submitted' -- esos tipos de evento quedaron sin ningún
-- emisor desde que el 2026-07-06 se rediseñó el tracking a click_call/click_whatsapp +
-- location_key (ver landing-track.ts). Esa card siempre muestra 0, en las tres sedes, desde esa
-- fecha -- una métrica muerta que aparenta medir algo. Esta función agrega los eventos reales
-- (click_call, click_whatsapp) por sede para reemplazarla, incluyendo Swiss Medical y Hospital
-- Británico aunque esos dos no usen el bot de WhatsApp de Lucía (Swiss tiene su propio WhatsApp,
-- "Swity"; Británico deriva a teléfono/central de turnos) -- el click en sí queda registrado igual,
-- lo que no se puede saber es si ese click terminó en un turno confirmado.
-- ============================================================

create or replace function landing_clicks_by_location(p_days int default 90)
returns table (location_key text, event_type text, event_count bigint)
language sql
stable
as $$
  select location_key, event_type, count(*) as event_count
  from landing_events
  where created_at >= now() - (p_days || ' days')::interval
    and event_type in ('click_call', 'click_whatsapp')
    and location_key is not null
  group by location_key, event_type;
$$;

-- Mismo alcance que las otras funciones de agregación de landing_events (PERF-01).
grant execute on function landing_clicks_by_location(int) to authenticated;
