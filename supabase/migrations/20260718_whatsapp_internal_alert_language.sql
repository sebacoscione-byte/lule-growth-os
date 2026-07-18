-- Meta approved the internal handoff alert under generic Spanish (`es`).
-- Keeping `es_AR` locally makes Cloud API reject every send with error 132001.
update templates
set language = 'es',
    updated_at = now()
where name = 'alerta_interna_derivacion'
  and language is distinct from 'es';
