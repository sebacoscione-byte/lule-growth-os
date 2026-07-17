-- ============================================================
-- Activa el modo sombra (fase 1) del clasificador estructurado nuevo, a pedido
-- explícito de Seba (2026-07-17). Usa jsonb_set sobre la clave puntual
-- `shadow_mode_enabled` -- NUNCA reemplaza el objeto whatsapp_settings entero,
-- para no pisar ai_provider/cost_saving_mode/thresholds/etc. ya cargados por
-- la UI de Configuración. Ver whatsapp-policy-shadow-runner.ts: solo compara
-- decisiones y guarda métricas sin PII, no cambia ninguna respuesta real.
-- ============================================================

update app_config
set value = jsonb_set(value, '{shadow_mode_enabled}', 'true'::jsonb)
where key = 'whatsapp_settings';

-- Si por algún motivo la fila todavía no existe (instalación nueva sin ningún
-- ajuste guardado desde Configuración todavía), la crea con el resto de los
-- defaults + shadow_mode_enabled en true.
insert into app_config (key, value)
select 'whatsapp_settings', '{
  "cost_saving_mode": false,
  "enable_service_message_charging": false,
  "warning_message_threshold": 8,
  "handoff_message_threshold": 12,
  "monthly_cost_alert_ars": null,
  "ai_provider": "sin_ia",
  "shadow_mode_enabled": true
}'::jsonb
where not exists (select 1 from app_config where key = 'whatsapp_settings');
