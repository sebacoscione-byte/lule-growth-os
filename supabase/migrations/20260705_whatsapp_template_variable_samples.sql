-- ============================================================
-- Agrega valores de ejemplo por variable a cada template, para poder
-- copiarlos directo en la seccion "Muestras de variables" que pide
-- Meta al crear la plantilla en WhatsApp Manager.
-- ============================================================

alter table templates
  add column if not exists variable_samples jsonb not null default '[]'::jsonb;

update templates set variable_samples = '["Juana", "CIMEL Lanús", "martes 10:00hs"]' where name = 'confirmacion_turno';
update templates set variable_samples = '["Juana", "CIMEL Lanús", "martes 10:00hs"]' where name = 'recordatorio_turno';
update templates set variable_samples = '["Juana", "un ecocardiograma", "venir en ayunas"]' where name = 'preparacion_consulta_estudios';
update templates set variable_samples = '["Juana", "tu DNI y el pedido médico"]' where name = 'solicitud_documentacion';
update templates set variable_samples = '["Juana"]' where name = 'seguimiento_post_consulta';
update templates set variable_samples = '["Juana", "Estudio de arritmias 2026"]' where name = 'invitacion_protocolo';
update templates set variable_samples = '["Juana"]' where name = 'recontacto_incompleto';
update templates set variable_samples = '["Juana", "el consultorio va a cerrar más temprano este viernes"]' where name = 'aviso_administrativo';
update templates set variable_samples = '["Juana"]' where name = 'derivacion_humano';
