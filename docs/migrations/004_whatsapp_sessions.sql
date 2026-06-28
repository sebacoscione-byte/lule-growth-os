-- ============================================================
-- Migración 004: tabla whatsapp_sessions para el bot de WhatsApp
-- Ejecutar en Supabase SQL Editor
-- ============================================================

create table if not exists whatsapp_sessions (
  id uuid default uuid_generate_v4() primary key,
  phone text not null unique,
  wa_name text,
  state text not null default 'nuevo'
    check (state in ('nuevo', 'esperando_obra_social', 'esperando_sede', 'derivado')),
  obra_social text,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_sessions_phone_idx on whatsapp_sessions(phone);
create index if not exists whatsapp_sessions_state_idx on whatsapp_sessions(state);
create index if not exists whatsapp_sessions_lead_id_idx on whatsapp_sessions(lead_id);

-- Trigger para updated_at
create trigger whatsapp_sessions_updated_at
  before update on whatsapp_sessions
  for each row execute function update_updated_at_column();

-- RLS
alter table whatsapp_sessions enable row level security;

create policy "service_role_all_whatsapp_sessions"
  on whatsapp_sessions for all to service_role using (true) with check (true);

create policy "authenticated_read_whatsapp_sessions"
  on whatsapp_sessions for select to authenticated using (true);
