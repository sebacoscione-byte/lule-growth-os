-- ============================================================
-- Migración: campos de protocolo/calificación en leads + nuevo
-- estado "intake_pendiente" en whatsapp_sessions (intake combinado
-- del bot, reemplaza preguntar obra social y sede una por una).
-- ============================================================

alter table leads
  add column if not exists protocol_interest boolean not null default false,
  add column if not exists protocol_name text,
  add column if not exists patient_age integer,
  add column if not exists prior_studies_or_symptoms text;

-- El check de status es un constraint sin nombre explícito en el
-- schema original: lo ubicamos dinámicamente para no depender de
-- cómo lo haya nombrado Postgres.
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
  'nuevo', 'interesado', 'calificado', 'derivado_cimel', 'derivado_swiss',
  'seguimiento_pendiente', 'confirmo_que_pidio_turno', 'no_pudo_pedir_turno',
  'requiere_humano', 'urgencia_derivada', 'descartado', 'spam', 'elegible_protocolo'
));

do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'whatsapp_sessions'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%state%esperando_obra_social%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table whatsapp_sessions drop constraint %I', existing_constraint);
  end if;
end $$;

alter table whatsapp_sessions add constraint whatsapp_sessions_state_check check (state in (
  'nuevo', 'intake_pendiente', 'esperando_obra_social', 'esperando_sede', 'derivado'
));
