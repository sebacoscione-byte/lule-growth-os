-- ============================================================
-- Lule Growth OS — Schema SQL para Supabase
-- Ejecutar en Supabase SQL Editor en este orden
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
    check (preferred_location in ('cimel_lanus','swiss_lomas','sin_definir')),
  preferred_day text not null default 'sin_definir'
    check (preferred_day in ('martes','viernes','sin_definir')),
  insurance text,
  general_reason text,
  consent_to_contact boolean not null default false,
  status text not null default 'nuevo'
    check (status in (
      'nuevo','interesado','calificado','derivado_cimel','derivado_swiss',
      'seguimiento_pendiente','confirmo_que_pidio_turno','no_pudo_pedir_turno',
      'requiere_humano','urgencia_derivada','descartado','spam'
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
  confirmed_booked boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  origin_url text,
  landing_page text,
  clicked_cimel_cta boolean not null default false,
  clicked_swiss_cta boolean not null default false,
  booking_instruction_viewed boolean not null default false
);

-- ============================================================
-- MESSAGES (conversación por lead)
-- ============================================================
create table if not exists messages (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
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

create policy "Authenticated users can do everything on config"
  on app_config for all using (auth.role() = 'authenticated');

create policy "service_role_write_ai_requests"
  on ai_requests for all to service_role using (true) with check (true);

create policy "authenticated_read_ai_requests"
  on ai_requests for select to authenticated using (true);

create policy "service_role_write_ai_outputs"
  on ai_outputs for all to service_role using (true) with check (true);

create policy "authenticated_read_ai_outputs"
  on ai_outputs for select to authenticated using (true);

-- ============================================================
-- SEED: Configuración inicial
-- ============================================================
insert into app_config (key, value) values
  ('doctor', '{"name": "Dra. Lucía Chahin", "specialty": "Cardiología", "services": ["Consulta cardiológica", "Ecocardiograma"]}'),
  ('locations', '[
    {"id": "cimel_lanus", "name": "CIMEL Lanús", "address": "Tucumán 1314, Lanús", "day": "martes", "services": ["Consulta cardiológica", "Ecocardiograma"], "booking_instruction": "Comunicate con CIMEL Lanús y solicitá turno con la Dra. Lucía Chahin."},
    {"id": "swiss_lomas", "name": "Swiss Medical Lomas", "address": null, "day": "viernes", "services": ["Consulta cardiológica", "Ecocardiograma"], "booking_instruction": "Pedí turno por los canales oficiales de Swiss Medical Lomas solicitando a la Dra. Lucía Chahin."}
  ]'),
  ('messages', '{
    "initial": "Hola, soy el asistente de la Dra. Lucía Chahin. Ella atiende consultas de cardiología y realiza ecocardiogramas.\n\nActualmente atiende:\n- Martes en CIMEL Lanús.\n- Viernes en Swiss Medical Lomas.\n\nPara orientarte, ¿buscás una consulta cardiológica o un ecocardiograma?",
    "followup": "Hola, te escribo para saber si pudiste pedir turno con la Dra. Lucía Chahin. Si tuviste algún problema, avisame y te paso nuevamente las indicaciones."
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
