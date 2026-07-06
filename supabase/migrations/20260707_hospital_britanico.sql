-- ============================================================
-- Hospital Británico como tercera sede de derivación (miércoles),
-- sumada a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).
-- ============================================================

-- preferred_location: el check es un constraint sin nombre explícito
-- en el schema original, lo ubicamos dinámicamente.
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'leads'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%preferred_location%cimel_lanus%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table leads drop constraint %I', existing_constraint);
  end if;
end $$;

alter table leads add constraint leads_preferred_location_check
  check (preferred_location in ('cimel_lanus', 'swiss_lomas', 'hospital_britanico', 'sin_definir'));

-- preferred_day
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'leads'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%preferred_day%martes%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table leads drop constraint %I', existing_constraint);
  end if;
end $$;

alter table leads add constraint leads_preferred_day_check
  check (preferred_day in ('martes', 'viernes', 'miercoles', 'sin_definir'));

-- status: agregar derivado_britanico (mismo patrón que la migración de protocolo)
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'leads'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%status%nuevo%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table leads drop constraint %I', existing_constraint);
  end if;
end $$;

alter table leads add constraint leads_status_check check (status in (
  'nuevo', 'interesado', 'calificado', 'derivado_cimel', 'derivado_swiss', 'derivado_britanico',
  'seguimiento_pendiente', 'confirmo_que_pidio_turno', 'no_pudo_pedir_turno',
  'requiere_humano', 'urgencia_derivada', 'descartado', 'spam', 'elegible_protocolo'
));

-- landing_events.event_type: agregar cta_britanico
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'landing_events'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%event_type%cta_cimel%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table landing_events drop constraint %I', existing_constraint);
  end if;
end $$;

alter table landing_events add constraint landing_events_event_type_check
  check (event_type in ('cta_cimel', 'cta_swiss', 'cta_britanico', 'instructions_viewed', 'form_started', 'form_submitted'));

-- leads: tracking de clic del CTA del Hospital Británico (mismo patrón que clicked_cimel_cta/clicked_swiss_cta)
alter table leads
  add column if not exists clicked_britanico_cta boolean not null default false;

-- app_config: agregar la sede a la lista de ubicaciones y actualizar el mensaje inicial del bot
update app_config
set value = '[
  {"id": "cimel_lanus", "name": "CIMEL Lanús", "address": "Tucumán 1314, Lanús", "day": "martes", "services": ["Consulta cardiológica", "Ecocardiograma"], "booking_instruction": "Comunicate con CIMEL Lanús y solicitá turno con la Dra. Lucía Chahin."},
  {"id": "swiss_lomas", "name": "Swiss Medical Lomas", "address": null, "day": "viernes", "services": ["Consulta cardiológica", "Ecocardiograma"], "booking_instruction": "Pedí turno por los canales oficiales de Swiss Medical Lomas solicitando a la Dra. Lucía Chahin."},
  {"id": "hospital_britanico", "name": "Hospital Británico", "address": "Perdriel 74, CABA", "day": "miercoles", "services": ["Consulta cardiológica", "Ecocardiograma"], "booking_instruction": "Llamá al 4309-6400 (atención telefónica 24hs) o a la Central de Turnos 0810-222-2748 / 11-3015-9749, o pedí turno desde la app del Hospital Británico, y solicitá turno con la Dra. Lucía Chahin en cardiología."}
]'
where key = 'locations';

update app_config
set value = jsonb_set(
  value,
  '{initial}',
  to_jsonb(
    'Hola, soy el asistente de la Dra. Lucía Chahin. Ella atiende consultas de cardiología y realiza ecocardiogramas.' || chr(10) || chr(10) ||
    'Actualmente atiende:' || chr(10) ||
    '- Martes en CIMEL Lanús.' || chr(10) ||
    '- Miércoles en Hospital Británico.' || chr(10) ||
    '- Viernes en Swiss Medical Lomas.' || chr(10) || chr(10) ||
    '¿Buscás una consulta cardiológica o un ecocardiograma?'
  )
)
where key = 'messages';
