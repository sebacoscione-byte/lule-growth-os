-- La Dra. Lucía Chahin confirmó que no atiende por PAMI. Se elimina esa entrada de la fuente
-- compartida por Configuración, landings y el bot administrativo, sin alterar otras coberturas.
update public.app_config
set value = (
  select jsonb_agg(
    case
      when jsonb_typeof(location->'obras_sociales') = 'array' then
        jsonb_set(
          location,
          '{obras_sociales}',
          coalesce((
            select jsonb_agg(coverage order by coverage_ordinal)
            from jsonb_array_elements(location->'obras_sociales')
              with ordinality as coverages(coverage, coverage_ordinal)
            where lower(trim(coverage #>> '{}')) not like 'pami%'
          ), '[]'::jsonb),
          true
        )
      else location
    end
    order by location_ordinal
  )
  from jsonb_array_elements(value) with ordinality as locations(location, location_ordinal)
)
where key = 'locations'
  and jsonb_typeof(value) = 'array';
