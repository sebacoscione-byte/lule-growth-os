-- ============================================================
-- Migración: idempotencia del webhook de WhatsApp (WA-02 / WA-03)
--
-- Contexto: Meta reintenta la entrega de un webhook si no recibe 200 a tiempo, y puede reenviar
-- el mismo evento más de una vez incluso sin errores de por medio. Antes de esta migración no
-- había forma de detectar un wa_message_id repetido, así que un reintento podía crear un segundo
-- mensaje entrante, disparar una segunda respuesta del bot y loguear un segundo evento de costo.
--
-- whatsapp_webhook_events reclama cada wa_message_id con una fila única antes de procesar nada
-- (sesión, costo, respuesta). Si el procesamiento fallo de forma transitoria, la fila queda en
-- failed_transient para permitir que un reintento de Meta lo vuelva a intentar; si tuvo éxito
-- queda en processed para que un reintento posterior se ignore en silencio.
-- ============================================================

create table if not exists whatsapp_webhook_events (
  id uuid default uuid_generate_v4() primary key,
  wa_message_id text not null unique,
  phone text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed_transient', 'failed_permanent')),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists whatsapp_webhook_events_status_idx on whatsapp_webhook_events(status);

alter table whatsapp_webhook_events enable row level security;

create policy "service_role_all_whatsapp_webhook_events"
  on whatsapp_webhook_events for all to service_role using (true) with check (true);
create policy "authenticated_read_whatsapp_webhook_events"
  on whatsapp_webhook_events for select to authenticated using (true);
