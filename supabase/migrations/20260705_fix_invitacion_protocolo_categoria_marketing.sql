-- ============================================================
-- Fix 4: invitacion_protocolo sigue siendo rechazado como Utility
-- despues de dos reescrituras. Es correcto: una invitacion a un
-- protocolo de investigacion es una solicitud de opt-in a algo nuevo,
-- no una notificacion sobre un turno/cuenta ya existente — Meta lo
-- clasifica (con razon) como Marketing. Esa categoria exige un
-- mecanismo de opt-out explicito en el texto (ademas del boton que
-- se agrega en WhatsApp Manager al crear la plantilla).
-- ============================================================

update templates
set category = 'marketing',
    body_text = 'Hola {{1}}, en el marco de tu atención con la Dra. Lucía Chahin, tu perfil médico podría ser compatible con el protocolo de investigación {{2}}. Es voluntario y requiere tu consentimiento explícito antes de avanzar. Respondé este mensaje si querés que te contactemos con más información, o "BAJA" si no querés recibir este tipo de mensajes.'
where name = 'invitacion_protocolo';
