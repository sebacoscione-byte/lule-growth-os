-- ============================================================
-- Migración: costos de WhatsApp Business Platform (Cloud API)
-- Ejecutar en Supabase SQL Editor / npm run migrate
--
-- Contexto: Meta cobra por mensaje entregado desde el 1/7/2025
-- (ya no por "conversación" de 24h). Hoy los mensajes service
-- (free-form) y los templates utility dentro de la ventana de
-- 24h son gratis; a partir del 1/10/2026 Meta anunció que deja
-- de ser así. whatsapp_pricing_rules modela esa estructura real
-- sin hardcodear montos (cost_amount queda null hasta que se
-- carguen los valores reales del tarifario de la cuenta desde
-- WhatsApp Manager > Facturación).
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

create index if not exists whatsapp_pricing_rules_lookup_idx
  on whatsapp_pricing_rules(country_code, category, is_template, in_window, entry_point, valid_from);

create trigger whatsapp_pricing_rules_updated_at
  before update on whatsapp_pricing_rules
  for each row execute function update_updated_at_column();

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
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_cost_events_wa_id_idx on whatsapp_cost_events(wa_id);
create index if not exists whatsapp_cost_events_lead_id_idx on whatsapp_cost_events(lead_id);
create index if not exists whatsapp_cost_events_created_at_idx on whatsapp_cost_events(created_at desc);
create index if not exists whatsapp_cost_events_flow_intent_idx on whatsapp_cost_events(flow_intent);

alter table whatsapp_sessions
  add column if not exists last_inbound_at timestamptz,
  add column if not exists entry_point text check (entry_point in ('organic', 'ctwa', 'referral')),
  add column if not exists ctwa_clid text,
  add column if not exists messages_sent_count integer not null default 0;

alter table messages
  add column if not exists direction text check (direction in ('inbound', 'outbound')),
  add column if not exists wa_message_id text,
  add column if not exists category text check (category in ('marketing', 'utility', 'authentication', 'service')),
  add column if not exists template_name text,
  add column if not exists window_state text check (window_state in ('open', 'closed')),
  add column if not exists flow_intent text,
  add column if not exists cost_estimated numeric(12, 4);

create index if not exists messages_wa_message_id_idx on messages(wa_message_id) where wa_message_id is not null;

-- RLS
alter table whatsapp_pricing_rules enable row level security;
alter table whatsapp_cost_events enable row level security;

create policy "service_role_all_whatsapp_pricing_rules"
  on whatsapp_pricing_rules for all to service_role using (true) with check (true);
create policy "authenticated_read_whatsapp_pricing_rules"
  on whatsapp_pricing_rules for select to authenticated using (true);
create policy "authenticated_write_whatsapp_pricing_rules"
  on whatsapp_pricing_rules for update to authenticated using (true) with check (true);

create policy "service_role_all_whatsapp_cost_events"
  on whatsapp_cost_events for all to service_role using (true) with check (true);
create policy "authenticated_read_whatsapp_cost_events"
  on whatsapp_cost_events for select to authenticated using (true);

-- ============================================================
-- SEED: estructura real de precios de Meta (sin montos — ver nota arriba)
-- Argentina, Cloud API directa. cost_amount se completa a mano
-- desde Configuración una vez que se tiene el tarifario de la cuenta.
-- ============================================================
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
