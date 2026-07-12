-- ============================================================
-- Migración: agregación de landing_events en SQL (PERF-01)
--
-- El dashboard traía hasta 20.000 filas crudas de landing_events y las agrupaba en JavaScript
-- (Map + for) para armar el ranking de landings y los resultados del test A/B del hero. Ese límite
-- de 20.000 era un tope de seguridad, no una garantía: si el tráfico real supera esa cifra en la
-- ventana de 90 días, el conteo queda mal (subestimado) en silencio, sin ningún error visible.
-- Estas dos funciones agregan directamente en Postgres (GROUP BY + COUNT FILTER) sin ningún tope
-- artificial, y devuelven solo las filas ya agregadas (unas pocas por sede/variante) en vez de
-- miles de filas crudas.
-- ============================================================

create or replace function landing_events_ranking(p_since timestamptz)
returns table(slug text, visits bigint, interactions bigint)
language sql
stable
as $$
  select
    slug,
    count(*) filter (where event_type = 'page_view') as visits,
    count(*) filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as interactions
  from landing_events
  where created_at >= p_since
    and event_type in ('page_view', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps')
  group by slug;
$$;

create or replace function landing_hero_variant_results(p_since timestamptz)
returns table(variant text, visits bigint, hero_primary_clicks bigint, hero_secondary_clicks bigint, interactions bigint)
language sql
stable
as $$
  select
    variant,
    count(*) filter (where event_type = 'page_view') as visits,
    count(*) filter (where event_type = 'click_hero_primary') as hero_primary_clicks,
    count(*) filter (where event_type = 'click_hero_secondary') as hero_secondary_clicks,
    count(*) filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')) as interactions
  from landing_events
  where slug = 'dra-lucia-chahin'
    and variant in ('a', 'b')
    and created_at >= p_since
    and event_type in ('page_view', 'click_hero_primary', 'click_hero_secondary', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps')
  group by variant;
$$;

-- Mismo alcance que la lectura directa de la tabla que reemplazan (authenticated_read_landing_events).
grant execute on function landing_events_ranking(timestamptz) to authenticated;
grant execute on function landing_hero_variant_results(timestamptz) to authenticated;
