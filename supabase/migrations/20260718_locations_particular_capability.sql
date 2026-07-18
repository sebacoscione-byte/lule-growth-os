-- Separa la capacidad de atención particular de las obras sociales/prepagas.
-- Compatibilidad actual: las sedes que tenían "Particular" en obras_sociales quedan habilitadas.
update app_config
set value = (
  select jsonb_agg(
    (location - 'obras_sociales' - 'accepts_particular')
    || jsonb_build_object(
      'obras_sociales', coalesce((
        select jsonb_agg(coverage)
        from jsonb_array_elements_text(coalesce(location->'obras_sociales', '[]'::jsonb)) coverage
        where lower(trim(coverage)) <> 'particular'
      ), '[]'::jsonb),
      'accepts_particular', coalesce(
        (location->>'accepts_particular')::boolean,
        exists (
          select 1
          from jsonb_array_elements_text(coalesce(location->'obras_sociales', '[]'::jsonb)) coverage
          where lower(trim(coverage)) = 'particular'
        ),
        false
      )
    )
    order by ordinal
  )
  from jsonb_array_elements(value) with ordinality locations(location, ordinal)
)
where key = 'locations'
  and jsonb_typeof(value) = 'array';
