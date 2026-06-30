-- Swiss Medical Lomas: agregar opción de pedir turno por la app de Swiss Medical
-- además del teléfono, y asegurar el teléfono de CIMEL Lanús en la config.

update app_config
set value = (
  select jsonb_agg(
    case
      when loc->>'id' = 'cimel_lanus' then
        loc || jsonb_build_object('phone', coalesce(nullif(loc->>'phone', ''), '011 4249-3412'))
      when loc->>'id' = 'swiss_lomas' then
        loc || jsonb_build_object(
          'phone', coalesce(nullif(loc->>'phone', ''), '0810-333-8876'),
          'booking_instruction', 'Llamá al 0810-333-8876 o buscala en la app de Swiss Medical, y solicitá turno con la Dra. Lucía Chahin.'
        )
      else loc
    end
  )
  from jsonb_array_elements(value) as loc
)
where key = 'locations';
