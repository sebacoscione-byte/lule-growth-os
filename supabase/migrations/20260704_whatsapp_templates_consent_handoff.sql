-- ============================================================
-- Migración: templates de Meta, consentimiento y derivación a humano
-- ============================================================

create table if not exists templates (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  category text not null check (category in ('utility', 'marketing')),
  language text not null default 'es_AR',
  status text not null default 'borrador'
    check (status in ('borrador', 'pendiente_meta', 'aprobado', 'rechazado')),
  body_text text not null,
  variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger templates_updated_at
  before update on templates
  for each row execute function update_updated_at_column();

create table if not exists consent_records (
  id uuid default uuid_generate_v4() primary key,
  wa_id text not null,
  lead_id uuid references leads(id) on delete set null,
  consented boolean not null,
  consent_text text not null,
  version text not null default 'v1',
  source text not null default 'whatsapp_bot',
  created_at timestamptz not null default now()
);

create index if not exists consent_records_wa_id_idx on consent_records(wa_id);
create index if not exists consent_records_lead_id_idx on consent_records(lead_id);

create table if not exists handoff_events (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references leads(id) on delete cascade,
  reason text not null
    check (reason in ('urgencia_medica', 'solicitud_explicita', 'conversacion_larga', 'intent_no_entendido', 'sin_template_valido')),
  summary jsonb not null default '{}'::jsonb,
  messages_sent_count integer not null default 0,
  cost_estimated_total numeric(12, 4),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists handoff_events_lead_id_idx on handoff_events(lead_id);
create index if not exists handoff_events_created_at_idx on handoff_events(created_at desc);

-- RLS
alter table templates enable row level security;
alter table consent_records enable row level security;
alter table handoff_events enable row level security;

create policy "service_role_all_templates"
  on templates for all to service_role using (true) with check (true);
create policy "authenticated_all_templates"
  on templates for all to authenticated using (true) with check (true);

create policy "service_role_all_consent_records"
  on consent_records for all to service_role using (true) with check (true);
create policy "authenticated_read_consent_records"
  on consent_records for select to authenticated using (true);

create policy "service_role_all_handoff_events"
  on handoff_events for all to service_role using (true) with check (true);
create policy "authenticated_read_handoff_events"
  on handoff_events for select to authenticated using (true);
create policy "authenticated_update_handoff_events"
  on handoff_events for update to authenticated using (true) with check (true);

-- ============================================================
-- SEED: 9 templates obligatorios (texto listo para enviar a
-- aprobación de Meta desde WhatsApp Manager). Todos utility salvo
-- que se conviertan a promocionales explícitos (marketing).
-- ============================================================
insert into templates (name, category, body_text, variables) values
  ('confirmacion_turno', 'utility', 'Hola {{1}}, te confirmamos que gestionaste tu turno con la Dra. Lucía Chahin en {{2}} el día {{3}}. Ante cualquier cambio, contactate directamente con la institución.', '["nombre", "sede", "fecha"]'),
  ('recordatorio_turno', 'utility', 'Hola {{1}}, te recordamos tu turno con la Dra. Lucía Chahin en {{2}} el día {{3}}. Si ya no podés asistir, gestioná el cambio directamente con la institución.', '["nombre", "sede", "fecha"]'),
  ('preparacion_consulta_estudios', 'utility', 'Hola {{1}}, para tu turno de {{2}} con la Dra. Lucía Chahin te recomendamos: {{3}}. Cualquier duda, escribinos.', '["nombre", "practica", "indicaciones"]'),
  ('solicitud_documentacion', 'utility', 'Hola {{1}}, para avanzar con tu consulta necesitamos que tengas a mano: {{2}}. Llevalo el día de tu turno.', '["nombre", "documentacion"]'),
  ('seguimiento_post_consulta', 'utility', 'Hola {{1}}, ¿cómo seguís después de tu consulta con la Dra. Lucía Chahin? Cualquier duda sobre las indicaciones, consultá directamente con la institución donde te atendiste.', '["nombre"]'),
  ('invitacion_protocolo', 'utility', 'Hola {{1}}, podrías ser compatible con el protocolo de investigación "{{2}}". Es voluntario y requiere tu consentimiento explícito. ¿Querés que te contactemos con el equipo para más información?', '["nombre", "protocolo"]'),
  ('recontacto_incompleto', 'utility', 'Hola {{1}}, notamos que no pudiste terminar de coordinar tu turno con la Dra. Lucía Chahin. ¿Te ayudamos a retomarlo?', '["nombre"]'),
  ('aviso_administrativo', 'utility', 'Hola {{1}}, te avisamos: {{2}}.', '["nombre", "aviso"]'),
  ('derivacion_humano', 'utility', 'Hola {{1}}, tu consulta fue derivada a una persona del equipo de la Dra. Lucía Chahin, te va a contactar a la brevedad.', '["nombre"]')
on conflict (name) do nothing;
