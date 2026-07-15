-- ============================================================
-- Template para alertar por WhatsApp (además de email) cuando el
-- bot deriva una conversación a una persona del equipo. Distinto
-- de "derivacion_humano" (ese es para el paciente); este es interno,
-- se manda al número de Seba/Lucía configurado en ALERT_WHATSAPP_TO.
-- Ver src/lib/whatsapp-handoff.ts.
-- ============================================================

insert into templates (name, category, body_text, variables, variable_samples) values
  ('alerta_interna_derivacion', 'utility',
   '🚨 {{1}} pidió hablar con una persona en Lule Growth OS. Motivo: {{2}}. Revisá el email o el Inbox para más detalle.',
   '["nombre_paciente", "motivo"]',
   '["Juana Pérez", "Pidió hablar con una persona del equipo"]')
on conflict (name) do nothing;
