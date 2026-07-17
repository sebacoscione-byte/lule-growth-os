-- landing_events: nuevo tipo de evento click_instagram.
-- Se agrega un link a Instagram cerca del inicio de todas las landings públicas (prueba social /
-- confianza: pacientes que llegan por la web pueden ver contenido real antes de pedir turno). Se
-- trackea igual que el resto de los CTAs de la landing (click_call/click_whatsapp/click_maps/etc.),
-- pero deliberadamente NO se agrega a los IN-list de "contact_actions"/"engaged" que usan las
-- funciones de dashboard_growth_metrics — no es una acción de intención de turno, mezclarla ahí
-- inflaría la tasa de conversión con clicks que no son un paso hacia agendar un turno.

do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'landing_events'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%event_type%cta_cimel%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table landing_events drop constraint %I', existing_constraint);
  end if;
end $$;

alter table landing_events add constraint landing_events_event_type_check
  check (event_type in (
    'cta_cimel', 'cta_swiss', 'cta_britanico', 'instructions_viewed', 'form_started', 'form_submitted',
    'page_view', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps',
    'click_hero_primary', 'click_hero_secondary', 'click_instagram'
  ));
