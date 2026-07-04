-- ============================================================
-- Fix 2: Meta clasificaba aviso_administrativo como "no coincide con
-- Utility" (texto demasiado generico, sin atarlo a la atencion del
-- paciente). Se ajusta la redaccion para que quede claro que es sobre
-- la atencion existente con la doctora, sin cambiar a Marketing.
-- ============================================================

update templates
set body_text = 'Hola {{1}}, te escribimos desde el consultorio de la Dra. Lucía Chahin con una novedad sobre tu atención: {{2}}. Ante cualquier duda, respondé este mensaje.'
where name = 'aviso_administrativo'
  and body_text = 'Hola {{1}}, te escribimos desde el consultorio de la Dra. Lucía Chahin para contarte lo siguiente: {{2}}. Ante cualquier duda, respondé este mensaje.';
