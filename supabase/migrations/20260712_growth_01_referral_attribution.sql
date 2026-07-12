-- ============================================================
-- Migración: atribución de punta a punta landing → WhatsApp → lead (GROWTH-01)
--
-- referral_code guarda temporalmente el código detectado en el primer mensaje (ej. "LAN-CARD-01",
-- ver src/lib/landing-referral-codes.ts) mientras la conversación pasa de "nuevo" a
-- "intake_pendiente" -- recién ahí se crea el lead y el código se copia a leads.utm_content /
-- leads.landing_page (columnas existentes desde antes, no se agrega nada a leads).
-- ============================================================

alter table whatsapp_sessions add column if not exists referral_code text;

-- Agregación en Postgres (no en JS) para landing_events, mismo criterio que PERF-01: la tabla ya
-- mostró que un conteo en JavaScript no escala. Se separa "visitas" (por slug, sin sede) de
-- "clicks a WhatsApp" (por slug + sede) porque un page_view no está atado a una sede puntual.
create or replace function landing_referral_events(p_days int default 90)
returns table (slug text, location_key text, event_type text, event_count bigint) as $$
  select slug, location_key, event_type, count(*) as event_count
  from landing_events
  where created_at >= now() - (p_days || ' days')::interval
    and event_type in ('page_view', 'click_whatsapp')
  group by slug, location_key, event_type
$$ language sql stable;
