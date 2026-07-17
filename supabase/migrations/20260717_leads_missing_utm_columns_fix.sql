-- 20260612_utm_fields.sql ya estaba marcado como aplicado en _migrations cuando alguien le agregó
-- estas 5 columnas más tarde (para GROWTH-01) -- npm run migrate nunca volvió a correr ese archivo
-- por nombre, así que nunca se crearon en la base real. Confirmado con information_schema.columns
-- y reproducido en vivo: POST /api/leads devuelve 500 ("Could not find the 'landing_page' column")
-- y upsert_whatsapp_intake_lead() falla en cada intake nuevo por WhatsApp (no solo con código de
-- referencia), porque hace `landing_page = coalesce(...)` de forma incondicional. Migración nueva,
-- nunca se re-edita una ya aplicada (ver CLAUDE.md → "Migraciones que tocan app_config").

alter table leads
  add column if not exists origin_url text,
  add column if not exists landing_page text,
  add column if not exists clicked_cimel_cta boolean not null default false,
  add column if not exists clicked_swiss_cta boolean not null default false,
  add column if not exists booking_instruction_viewed boolean not null default false;

create index if not exists leads_landing_page_idx on leads(landing_page);
