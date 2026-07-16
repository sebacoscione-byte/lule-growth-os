-- ============================================================
-- Fase 0A: consentimiento explícito y minimización del caché IA
--
-- Esta migración acompaña el código, pero no se ejecuta automáticamente
-- durante el desarrollo local ni debe aplicarse sin el flujo de despliegue.
-- ============================================================

-- El bot separa la solicitud de consentimiento del intake administrativo.
do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'whatsapp_sessions'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%state%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table whatsapp_sessions drop constraint %I', existing_constraint);
  end if;
end $$;

alter table whatsapp_sessions
  add constraint whatsapp_sessions_state_check check (state in (
    'nuevo', 'esperando_consentimiento', 'intake_pendiente',
    'esperando_obra_social', 'esperando_sede', 'derivado'
  ));

-- Evidencia y finalidad explícitas para el consentimiento administrativo. Los registros v1 se
-- marcan como legacy: fueron creados por una lógica que infería aceptación y no deben habilitar
-- el nuevo flujo.
alter table consent_records
  add column if not exists purpose text,
  add column if not exists evidence_message_id text;

update consent_records
set purpose = 'legacy_unspecified'
where purpose is null
   or coalesce(version, '') <> 'v2-administrative-service';

alter table consent_records
  drop constraint if exists consent_records_purpose_check;

alter table consent_records
  alter column version set default 'v2-administrative-service',
  alter column purpose set default 'administrative_service',
  alter column purpose set not null,
  add constraint consent_records_purpose_check
    check (purpose in ('legacy_unspecified', 'administrative_service', 'appointment_followup', 'marketing', 'research_protocol'));

create index if not exists consent_records_wa_id_purpose_created_idx
  on consent_records(wa_id, purpose, created_at desc);

delete from consent_records c
using consent_records duplicate
where c.evidence_message_id is not null
  and c.purpose = duplicate.purpose
  and c.evidence_message_id = duplicate.evidence_message_id
  and c.id > duplicate.id;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'consent_records_purpose_evidence_unique'
  ) then
    alter table consent_records
      add constraint consent_records_purpose_evidence_unique
      unique (purpose, evidence_message_id);
  end if;
end $$;

-- El perfil público y el click-id del anuncio no son necesarios antes de aceptar. El entry_point
-- categórico alcanza para costos/ventana; se limpian asociaciones legacy innecesarias.
update whatsapp_sessions s
set wa_name = null
where wa_name is not null
  and not exists (
    select 1
    from consent_records c
    where c.wa_id = s.phone
      and c.purpose = 'administrative_service'
      and c.version = 'v2-administrative-service'
      and c.consented = true
  );

update whatsapp_sessions set ctwa_clid = null where ctwa_clid is not null;

-- El booleano legacy mezclaba consentimiento administrativo con seguimiento proactivo. Hasta
-- incorporar un opt-in específico appointment_followup, ningún lead de WhatsApp queda habilitado
-- para que el cron inicie contacto por su cuenta.
update leads
set consent_to_contact = false
where origin_channel = 'whatsapp'
  and consent_to_contact = true;

-- Los prompts de estas finalidades pueden contener mensajes de pacientes. El código deja de
-- persistirlos; se eliminan también las copias históricas del caché derivado.
delete from ai_outputs
where purpose in ('whatsapp_intent', 'classify', 'reply', 'followup_suggestion');

update ai_requests
set error_message = 'patient_context_request_failed'
where purpose in ('whatsapp_intent', 'classify', 'reply', 'followup_suggestion')
  and error_message is not null;

-- La alerta interna anterior incluía dos variables (nombre/motivo). Se reemplaza por una referencia
-- técnica no identificable y se fuerza nueva aprobación en Meta antes de volver a enviarla.
update templates
set body_text = 'Hay una derivación pendiente en Lule Growth OS. Caso {{1}}. Revisá el Inbox autenticado para más detalle.',
    variables = '["referencia_caso"]'::jsonb,
    variable_samples = '["CASO-1234ABCD"]'::jsonb,
    status = 'borrador',
    updated_at = now()
where name = 'alerta_interna_derivacion'
  and (
    variables is distinct from '["referencia_caso"]'::jsonb
    or body_text is distinct from 'Hay una derivación pendiente en Lule Growth OS. Caso {{1}}. Revisá el Inbox autenticado para más detalle.'
  );
