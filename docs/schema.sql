-- ============================================================
-- Lule Growth OS — snapshot base del schema para Supabase
--
-- NO desplegar este archivo de forma aislada: las migraciones versionadas son la fuente canónica
-- del estado actual. Después de este snapshot deben aplicarse, por nombre/fecha, entre otras:
--   20260715_whatsapp_phase0a_safety.sql
--   20260716_whatsapp_phase0b_operations.sql
--   20260716_whatsapp_phase1_durable_transport.sql
--   20260716_whatsapp_phase1b_outbound_ledger.sql
--   20260716_whatsapp_phase1c_queue_checkpoint.sql
--   20260716_whatsapp_phase1d_atomic_routing.sql
--   20260716_whatsapp_phase1e_erasure_suppression.sql
--   20260716_whatsapp_policy_shadow.sql
--   20260716_whatsapp_privacy_roles_retention.sql
-- La última reemplaza las políticas amplias de compatibilidad de este snapshot por roles/MFA.
-- Este snapshot es un bootstrap base y omite deliberadamente parte del delta operativo de esas
-- migraciones (queue checkpoint, identity map, tombstones y RPCs); no representa por sí solo el
-- esquema efectivo ni debe usarse para saltar migraciones.
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- LEADS
-- ============================================================
create table if not exists leads (
  id uuid default uuid_generate_v4() primary key,
  name text,
  phone text,
  instagram_username text,
  origin_channel text not null default 'manual'
    check (origin_channel in ('google_maps','google_search','instagram','whatsapp','manual','referral','landing_page')),
  origin_campaign text,
  searched_keyword text,
  requested_service text not null default 'no_definido'
    check (requested_service in ('consulta_cardiologia','ecocardiograma','no_definido')),
  preferred_location text not null default 'sin_definir'
    check (preferred_location in ('cimel_lanus','swiss_lomas','hospital_britanico','sin_definir')),
  preferred_day text not null default 'sin_definir'
    check (preferred_day in ('martes','viernes','miercoles','sin_definir')),
  insurance text,
  general_reason text,
  consent_to_contact boolean not null default false,
  status text not null default 'nuevo'
    check (status in (
      'nuevo','interesado','calificado','derivado_cimel','derivado_swiss','derivado_britanico',
      'seguimiento_pendiente','confirmo_que_pidio_turno','no_pudo_pedir_turno',
      'requiere_humano','urgencia_derivada','descartado','spam','elegible_protocolo'
    )),
  priority_score integer not null default 1,
  possible_emergency boolean not null default false,
  requires_human boolean not null default false,
  ai_summary text,
  last_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referred_at timestamptz,
  followup_due_at timestamptz,
  whatsapp_followup_sent_at timestamptz,
  whatsapp_followup_claimed_at timestamptz,
  whatsapp_followup_status text not null default 'not_requested'
    check (whatsapp_followup_status in ('not_requested','pending','dispatching','sent','declined','cancelled','ambiguous')),
  confirmed_booked boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  origin_url text,
  landing_page text,
  clicked_cimel_cta boolean not null default false,
  clicked_swiss_cta boolean not null default false,
  clicked_britanico_cta boolean not null default false,
  booking_instruction_viewed boolean not null default false,
  protocol_interest boolean not null default false,
  protocol_opt_out boolean not null default false,
  protocol_name text,
  patient_age integer,
  prior_studies_or_symptoms text
);

-- ============================================================
-- MESSAGES (conversación por lead)
-- ============================================================
create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  direction text check (direction in ('inbound', 'outbound')),
  wa_message_id text unique,
  category text check (category in ('marketing', 'utility', 'authentication', 'service')),
  template_name text,
  window_state text check (window_state in ('open', 'closed')),
  flow_intent text,
  cost_estimated numeric(12, 4),
  delivery_status text,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  delivery_error_code text,
  outbound_ledger_key text unique
);

-- ============================================================
-- GROWTH EXPERIMENTS
-- ============================================================
create table if not exists growth_experiments (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  channel text not null
    check (channel in ('google_maps','seo','instagram','google_ads','whatsapp','referrals')),
  hypothesis text not null,
  content_or_action text not null,
  start_date date not null,
  end_date date,
  metric_to_improve text not null,
  result text,
  winner boolean,
  created_at timestamptz not null default now()
);

-- ============================================================
-- GOOGLE LOCAL CHECKLIST ITEMS (estado persistido)
-- ============================================================
create table if not exists google_local_checklist (
  id uuid default uuid_generate_v4() primary key,
  item_key text not null unique,
  completed boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- APP CONFIG (configuración editable)
-- ============================================================
create table if not exists app_config (
  id uuid default uuid_generate_v4() primary key,
  key text not null unique,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Historial de app_config: guarda sólo las cinco claves operativas no secretas de la whitelist
-- antes de un UPDATE. Tokens e IDs internos de integraciones nunca se copian a este historial.
create table if not exists app_config_history (
  id uuid default uuid_generate_v4() primary key,
  key text not null,
  value jsonb not null,
  changed_at timestamptz not null default now()
);

create or replace function log_app_config_change() returns trigger as $$
begin
  if old.key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline']) then
    insert into app_config_history (key, value) values (old.key, old.value);
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger app_config_before_update
  before update on app_config
  for each row execute function log_app_config_change();

-- ============================================================
-- AI AUDIT + CACHE
-- ============================================================
create table if not exists ai_requests (
  id uuid default uuid_generate_v4() primary key,
  provider text not null,
  model text,
  prompt_hash text not null,
  purpose text not null,
  created_at timestamptz not null default now(),
  success boolean not null default true,
  error_message text
);

create table if not exists ai_outputs (
  id uuid default uuid_generate_v4() primary key,
  prompt_hash text not null,
  purpose text not null,
  input_prompt text not null,
  output_text text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LANDING EVENTS (clicks anónimos en CTAs — sin login)
-- ============================================================
create table if not exists landing_events (
  id uuid default uuid_generate_v4() primary key,
  event_type text not null
    check (event_type in (
      'cta_cimel', 'cta_swiss', 'cta_britanico', 'instructions_viewed', 'form_started', 'form_submitted',
      'page_view', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps',
      'click_hero_primary', 'click_hero_secondary'
    )),
  slug text not null,
  location_key text check (location_key is null or location_key in ('cimel', 'swiss', 'britanico')),
  variant text check (variant is null or variant in ('a', 'b')),
  -- UUID aleatorio por pestaña/sesión (sessionStorage), sin cookie ni PII. Permite deduplicar
  -- varias acciones de una misma visita en las tasas del dashboard.
  session_id uuid,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- WEEKLY REPORTS (snapshot generado por /api/cron/weekly-report)
-- ============================================================
create table if not exists weekly_reports (
  id uuid default uuid_generate_v4() primary key,
  week_start date not null,
  week_end date not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SNAPSHOTS MULTICANAL (cron diario publish-content)
-- ============================================================
create table if not exists instagram_follower_snapshots (
  id uuid default uuid_generate_v4() primary key,
  captured_on date not null,
  followers_count int not null,
  reach int,
  profile_views int,
  link_taps int,
  total_interactions int,
  created_at timestamptz not null default now()
);

create table if not exists google_business_snapshots (
  id uuid default uuid_generate_v4() primary key,
  captured_on date not null,
  rating numeric(2, 1),
  review_count int,
  impressions_search int,
  impressions_maps int,
  website_clicks int,
  call_clicks int,
  direction_requests int,
  performance_status text not null default 'pending'
    check (performance_status in ('available', 'quota_blocked', 'not_connected', 'pending', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- WHATSAPP COST TRACKING (ver supabase/migrations/20260704_whatsapp_cost_tracking.sql
-- para el detalle de por qué cost_amount queda null en varias filas)
-- ============================================================
create table if not exists whatsapp_pricing_rules (
  id uuid default uuid_generate_v4() primary key,
  country_code text not null,
  currency text not null,
  category text not null check (category in ('marketing', 'utility', 'authentication', 'service')),
  is_template boolean not null default false,
  in_window boolean not null default true,
  entry_point text not null default 'any' check (entry_point in ('organic', 'ctwa', 'referral', 'any')),
  provider text not null default 'cloud_api' check (provider in ('cloud_api', 'bsp', 'meta_business_agent')),
  cost_amount numeric(12, 4),
  valid_from date not null,
  valid_to date,
  source_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_cost_events (
  id uuid default uuid_generate_v4() primary key,
  phone_number_id text,
  wa_id text not null,
  lead_id uuid references leads(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null,
  category text not null check (category in ('marketing', 'utility', 'authentication', 'service')),
  is_template boolean not null default false,
  template_name text,
  in_window boolean not null default true,
  entry_point text not null default 'organic' check (entry_point in ('organic', 'ctwa', 'referral')),
  char_count integer,
  ai_tokens_estimated integer,
  cost_estimated numeric(12, 4),
  currency text,
  flow_intent text,
  window_state text check (window_state in ('open', 'closed')),
  wa_message_id text unique,
  delivery_status text,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  delivery_error_code text,
  outbound_ledger_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists templates (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  category text not null check (category in ('utility', 'marketing')),
  language text not null default 'es_AR',
  status text not null default 'borrador'
    check (status in ('borrador', 'pendiente_meta', 'aprobado', 'rechazado')),
  body_text text not null,
  variables jsonb not null default '[]'::jsonb,
  variable_samples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists consent_records (
  id uuid default uuid_generate_v4() primary key,
  wa_id text not null,
  lead_id uuid references leads(id) on delete set null,
  consented boolean not null,
  consent_text text not null,
  version text not null default 'v2-administrative-service',
  purpose text not null default 'administrative_service'
    check (purpose in ('legacy_unspecified', 'administrative_service', 'appointment_followup', 'marketing', 'research_protocol')),
  evidence_message_id text,
  source text not null default 'whatsapp_bot',
  created_at timestamptz not null default now(),
  unique (purpose, evidence_message_id)
);

create index if not exists consent_records_wa_id_purpose_created_idx
  on consent_records(wa_id, purpose, created_at desc);

create table if not exists handoff_events (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references leads(id) on delete cascade,
  reason text not null
    check (reason in ('urgencia_medica', 'solicitud_explicita', 'conversacion_larga', 'intent_no_entendido', 'sin_template_valido', 'entrega_ambigua')),
  summary jsonb not null default '{}'::jsonb,
  messages_sent_count integer not null default 0,
  cost_estimated_total numeric(12, 4),
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  taken_by text,
  source_wa_message_id text,
  resolved_at timestamptz,
  resolved_by text
);

create unique index if not exists handoff_events_source_reason_unique
  on handoff_events(source_wa_message_id, reason)
  where source_wa_message_id is not null;

alter table whatsapp_pricing_rules enable row level security;
alter table whatsapp_cost_events enable row level security;
alter table templates enable row level security;
alter table consent_records enable row level security;
alter table handoff_events enable row level security;

create policy "service_role_all_whatsapp_pricing_rules" on whatsapp_pricing_rules for all to service_role using (true) with check (true);
create policy "authenticated_read_whatsapp_pricing_rules" on whatsapp_pricing_rules for select to authenticated using (true);
create policy "authenticated_write_whatsapp_pricing_rules" on whatsapp_pricing_rules for update to authenticated using (true) with check (true);

create policy "service_role_all_whatsapp_cost_events" on whatsapp_cost_events for all to service_role using (true) with check (true);
create policy "authenticated_read_whatsapp_cost_events" on whatsapp_cost_events for select to authenticated using (true);

create policy "service_role_all_templates" on templates for all to service_role using (true) with check (true);
create policy "authenticated_all_templates" on templates for all to authenticated using (true) with check (true);

create policy "service_role_all_consent_records" on consent_records for all to service_role using (true) with check (true);
create policy "authenticated_read_consent_records" on consent_records for select to authenticated using (true);

create policy "service_role_all_handoff_events" on handoff_events for all to service_role using (true) with check (true);
create policy "authenticated_read_handoff_events" on handoff_events for select to authenticated using (true);
create policy "authenticated_update_handoff_events" on handoff_events for update to authenticated using (true) with check (true);

insert into whatsapp_pricing_rules (country_code, currency, category, is_template, in_window, entry_point, provider, cost_amount, valid_from, valid_to, source_note) values
  ('AR', 'ARS', 'marketing', true, false, 'organic', 'cloud_api', null, '2025-07-01', null, 'Template marketing fuera de ventana: pago por mensaje entregado desde 1/7/2025. Completar cost_amount con el tarifario real (WhatsApp Manager > Facturación).'),
  ('AR', 'ARS', 'utility', true, false, 'organic', 'cloud_api', null, '2025-07-01', null, 'Template utility fuera de ventana: pago por mensaje entregado desde 1/7/2025. Completar cost_amount real.'),
  ('AR', 'ARS', 'authentication', true, false, 'organic', 'cloud_api', null, '2025-07-01', null, 'Template authentication: pago por mensaje entregado desde 1/7/2025. Completar cost_amount real.'),
  ('AR', 'ARS', 'utility', true, true, 'organic', 'cloud_api', 0, '2025-07-01', '2026-09-30', 'Template utility dentro de ventana de 24h: gratis hasta el 30/9/2026.'),
  ('AR', 'ARS', 'utility', true, true, 'organic', 'cloud_api', null, '2026-10-01', null, 'A partir del 1/10/2026 Meta cobra tambien utility dentro de ventana. Completar cost_amount real antes de esa fecha.'),
  ('AR', 'ARS', 'service', false, true, 'organic', 'cloud_api', 0, '2025-07-01', '2026-09-30', 'Mensajes service (free-form) dentro de ventana de 24h: gratis hasta el 30/9/2026.'),
  ('AR', 'ARS', 'service', false, true, 'organic', 'cloud_api', null, '2026-10-01', null, 'A partir del 1/10/2026 Meta cobra tambien los mensajes service dentro de ventana. Completar cost_amount real antes de esa fecha.'),
  ('AR', 'ARS', 'marketing', true, true, 'ctwa', 'cloud_api', 0, '2025-07-01', null, 'Free Entry Point (Click-to-WhatsApp/CTA de Pagina): ventana de 72h gratis para cualquier tipo de mensaje mientras este abierta.'),
  ('AR', 'ARS', 'service', false, true, 'ctwa', 'cloud_api', 0, '2025-07-01', null, 'Free Entry Point (Click-to-WhatsApp/CTA de Pagina): ventana de 72h gratis para cualquier tipo de mensaje mientras este abierta.')
on conflict do nothing;

insert into templates (name, category, body_text, variables, variable_samples) values
  ('invitacion_protocolo', 'marketing', 'Hola {{1}}. Como aceptaste recibir información sobre protocolos, una persona del equipo puede contarte aspectos administrativos de {{2}}. Esto no determina elegibilidad ni reemplaza el consentimiento del estudio. Respondé "BAJA" si no querés recibir más mensajes de esta finalidad.', '["nombre", "protocolo"]', '["Juana", "protocolo informado"]'),
  ('recontacto_incompleto', 'utility', 'Hola {{1}}, notamos que no pudiste terminar de coordinar tu turno con la Dra. Lucía Chahin. ¿Te ayudamos a retomarlo?', '["nombre"]', '["Juana"]'),
  ('aviso_administrativo', 'utility', 'Hola {{1}}, te escribimos desde el consultorio de la Dra. Lucía Chahin con una novedad sobre tu atención: {{2}}. Ante cualquier duda, respondé este mensaje.', '["nombre", "aviso"]', '["Juana", "el consultorio va a cerrar más temprano este viernes"]'),
  ('derivacion_humano', 'utility', 'Hola {{1}}, tu consulta quedó derivada al equipo de la Dra. Lucía Chahin. Podés continuar por este canal cuando una persona tome el caso.', '["nombre"]', '["Juana"]'),
  ('alerta_interna_derivacion', 'utility', 'Hay una derivación pendiente en Lule Growth OS. Caso {{1}}. Revisá el Inbox autenticado para más detalle.', '["referencia_caso"]', '["CASO-1234ABCD"]')
on conflict (name) do nothing;

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_origin_channel_idx on leads(origin_channel);
create index if not exists leads_created_at_idx on leads(created_at desc);
create index if not exists leads_followup_due_idx on leads(followup_due_at) where followup_due_at is not null;
create index if not exists leads_utm_source_idx on leads(utm_source);
create index if not exists leads_landing_page_idx on leads(landing_page);
create index if not exists messages_lead_id_idx on messages(lead_id);
create unique index if not exists ai_outputs_prompt_hash_idx on ai_outputs(prompt_hash);
create index if not exists ai_requests_created_at_idx on ai_requests(created_at);
create index if not exists ai_requests_prompt_hash_idx on ai_requests(prompt_hash);
create index if not exists landing_events_slug_idx on landing_events(slug);
create index if not exists landing_events_event_type_idx on landing_events(event_type);
create index if not exists landing_events_created_at_idx on landing_events(created_at desc);
create index if not exists landing_events_location_key_idx on landing_events(location_key);
create index if not exists landing_events_utm_content_idx on landing_events(utm_content);
create index if not exists landing_events_session_id_idx on landing_events(session_id);
create index if not exists landing_events_created_type_session_idx on landing_events(created_at desc, event_type, session_id);
create unique index if not exists weekly_reports_week_start_idx on weekly_reports(week_start);
create unique index if not exists instagram_follower_snapshots_captured_on_idx on instagram_follower_snapshots(captured_on);
create unique index if not exists google_business_snapshots_captured_on_idx on google_business_snapshots(captured_on);

-- ============================================================
-- UPDATED_AT trigger
-- ============================================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at_column();

create trigger config_updated_at
  before update on app_config
  for each row execute function update_updated_at_column();

create trigger checklist_updated_at
  before update on google_local_checklist
  for each row execute function update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table leads enable row level security;
alter table messages enable row level security;
alter table growth_experiments enable row level security;
alter table google_local_checklist enable row level security;
alter table app_config enable row level security;
alter table app_config_history enable row level security;
alter table ai_requests enable row level security;
alter table ai_outputs enable row level security;

-- Solo usuarios autenticados pueden ver y modificar todo
create policy "Authenticated users can do everything on leads"
  on leads for all using (auth.role() = 'authenticated');

create policy "Authenticated users can do everything on messages"
  on messages for all using (auth.role() = 'authenticated');

create policy "Authenticated users can do everything on experiments"
  on growth_experiments for all using (auth.role() = 'authenticated');

create policy "Authenticated users can do everything on checklist"
  on google_local_checklist for all using (auth.role() = 'authenticated');

-- Políticas finales y restricciones por rol: ver migración canónica
-- `20260716_whatsapp_privacy_roles_retention.sql`. En particular, los clientes autenticados sólo
-- acceden a una whitelist de configuración no secreta; tokens OAuth y el historial quedan
-- exclusivamente bajo service_role.

create policy "service_role_write_ai_requests"
  on ai_requests for all to service_role using (true) with check (true);

create policy "authenticated_read_ai_requests"
  on ai_requests for select to authenticated using (true);

create policy "service_role_write_ai_outputs"
  on ai_outputs for all to service_role using (true) with check (true);

create policy "authenticated_read_ai_outputs"
  on ai_outputs for select to authenticated using (true);

alter table landing_events enable row level security;

create policy "service_role_write_landing_events"
  on landing_events for all to service_role using (true) with check (true);

create policy "authenticated_read_landing_events"
  on landing_events for select to authenticated using (true);

alter table weekly_reports enable row level security;

create policy "service_role_write_weekly_reports"
  on weekly_reports for all to service_role using (true) with check (true);

create policy "authenticated_read_weekly_reports"
  on weekly_reports for select to authenticated using (true);

alter table instagram_follower_snapshots enable row level security;

create policy "service_role_write_instagram_follower_snapshots"
  on instagram_follower_snapshots for all to service_role using (true) with check (true);

create policy "authenticated_read_instagram_follower_snapshots"
  on instagram_follower_snapshots for select to authenticated using (true);

alter table google_business_snapshots enable row level security;

create policy "service_role_write_google_business_snapshots"
  on google_business_snapshots for all to service_role using (true) with check (true);

create policy "authenticated_read_google_business_snapshots"
  on google_business_snapshots for select to authenticated using (true);

-- ============================================================
-- SEED: Configuración inicial
-- Las sedes nacen deliberadamente inactivas y NO VERIFICADAS. Una persona `owner` debe completar
-- y guardar cada fila por `/api/config` para que el servidor selle verified_at/by/valid_from.
-- ============================================================
insert into app_config (key, value) values
  ('doctor', '{
    "name": "Dra. Lucía Chahin",
    "specialty": "Cardiología",
    "services": ["Consulta cardiológica", "Ecocardiograma"],
    "specializations": ["Ecocardiografía", "Electrocardiografía", "Cardiología Adulto"],
    "conditions_treated": [
      "Angina de pecho", "Arritmias", "Desmayo", "Embolismo pulmonar", "Endocarditis",
      "Enfermedad de Chagas", "Enfermedad coronaria", "Enfermedad valvular",
      "Enfermedad de las arterias carótidas", "Espasmo arterial", "Hipertensión arterial",
      "Insuficiencia cardiaca", "Soplo cardiaco", "Infarto"
    ]
  }'),
  ('locations', '[
    {"id": "cimel_lanus", "name": "CIMEL Lanús", "services": [], "active": false},
    {"id": "swiss_lomas", "name": "Swiss Medical Lomas", "services": [], "active": false},
    {"id": "hospital_britanico", "name": "Hospital Británico", "services": [], "active": false}
  ]'),
  ('messages', '{
    "initial": "Hola, soy el asistente administrativo de la Dra. Lucía Chahin. Puedo orientarte sobre los canales oficiales para pedir turno. ¿Buscás una consulta cardiológica o un ecocardiograma?",
    "followup": "Hola, te escribimos una sola vez, como aceptaste, para saber si pudiste pedir turno. Si necesitás los canales oficiales nuevamente, respondé este mensaje."
  }')
on conflict (key) do nothing;

-- ============================================================
-- SEED: Google Local Checklist
-- ============================================================
insert into google_local_checklist (item_key) values
  ('nombre_correcto'),
  ('categoria_principal'),
  ('ubicacion_cimel'),
  ('horario_real'),
  ('servicios_cargados'),
  ('descripcion_cargada'),
  ('fotos_profesionales'),
  ('link_landing'),
  ('telefono_configurado'),
  ('primera_publicacion'),
  ('preguntas_frecuentes'),
  ('categoria_cardiologia'),
  ('link_instagram_bio'),
  ('posts_fijados_3')
on conflict (item_key) do nothing;

-- ============================================================
-- SEED: Experimentos iniciales
-- ============================================================
insert into growth_experiments (name, channel, hypothesis, content_or_action, start_date, metric_to_improve) values
  ('Ficha profesional Google', 'google_maps', 'Crear ficha individual de Lucía generará leads desde Google Maps', 'Crear perfil de negocio como Dra. Lucía Chahin, categoría Cardióloga, ubicación CIMEL Lanús', current_date, 'leads desde google_maps'),
  ('Landing cardióloga Lanús', 'seo', 'Una landing optimizada para "cardióloga en Lanús" capturará tráfico orgánico', 'Publicar /landings/cardiologa-lanus con contenido SEO local', current_date, 'leads desde landing_page'),
  ('CTA Escribí ECO', 'instagram', 'La palabra clave ECO en stories convertirá mejor que texto largo', 'Publicar 3 stories con CTA "Escribí ECO" y medir respuestas', current_date, 'leads desde instagram')
on conflict do nothing;
