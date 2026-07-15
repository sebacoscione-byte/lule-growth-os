-- ============================================================
-- Activa el respaldo de IA del bot de WhatsApp (Gemini) a pedido
-- explícito de Seba (2026-07-15). Usa jsonb_set sobre la clave
-- puntual `ai_provider` -- NUNCA reemplaza el objeto whatsapp_settings
-- entero, para no pisar cost_saving_mode/thresholds/etc. ya cargados
-- por la UI de Configuración. Ver CLAUDE.md -> "Bot de WhatsApp con
-- IA de respaldo".
-- ============================================================

update app_config
set value = jsonb_set(value, '{ai_provider}', '"gemini"')
where key = 'whatsapp_settings';

-- Si por algún motivo la fila todavía no existe (instalación nueva sin
-- ningún ajuste guardado desde Configuración todavía), la crea con el
-- resto de los defaults + ai_provider en gemini.
insert into app_config (key, value)
select 'whatsapp_settings', '{
  "cost_saving_mode": false,
  "enable_service_message_charging": false,
  "warning_message_threshold": 8,
  "handoff_message_threshold": 12,
  "monthly_cost_alert_ars": null,
  "ai_provider": "gemini"
}'::jsonb
where not exists (select 1 from app_config where key = 'whatsapp_settings');
