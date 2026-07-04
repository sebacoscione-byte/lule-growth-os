-- ============================================================
-- Fix 3: Meta marcaba invitacion_protocolo y seguimiento_post_consulta
-- como "no coincide con Utility" (mismo motivo que aviso_administrativo:
-- el texto no ataba el mensaje a la atencion existente del paciente,
-- sonaba a invitacion/re-enganche generico). Se ajusta la redaccion
-- para que quede explicito que es sobre la atencion con la doctora.
-- ============================================================

update templates
set body_text = 'Hola {{1}}, en el marco de tu atención con la Dra. Lucía Chahin, tu perfil médico podría ser compatible con el protocolo de investigación {{2}}. Es voluntario y requiere tu consentimiento explícito antes de avanzar. Respondé este mensaje si querés que te contactemos con más información.'
where name = 'invitacion_protocolo';

update templates
set body_text = 'Hola {{1}}, te escribimos sobre tu atención con la Dra. Lucía Chahin para saber cómo seguís después de tu consulta. Si tenés dudas sobre las indicaciones que te dieron, consultá directamente con la institución donde te atendiste.'
where name = 'seguimiento_post_consulta';
