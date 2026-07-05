-- ============================================================
-- Opt-out explícito del template invitacion_protocolo (botón "No,
-- gracias"): permite no volver a contactar al paciente por protocolos
-- de investigación, sin afectar el resto del contacto con la práctica.
-- ============================================================

alter table leads
  add column if not exists protocol_opt_out boolean not null default false;
