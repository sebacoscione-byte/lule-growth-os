-- landing_events: eventos granulares (visitas y clicks por tipo de accion/sede).
-- Hoy solo se registraba un evento combinado por sede (cta_cimel/cta_swiss/cta_britanico) al
-- primer engagement, sin distinguir booking/llamada/whatsapp/mapa, y no habia ningun evento de
-- visita a la landing. Se agregan tipos nuevos + una columna opcional location_key para desglosar
-- por sede, sin tocar los event_type historicos (los usa el dashboard global).

alter table landing_events add column if not exists location_key text
  check (location_key is null or location_key in ('cimel', 'swiss', 'britanico'));

-- utm_content llegaba en el body de /api/public/click (lo manda useUtmParams desde la URL) pero se
-- descartaba en silencio porque la tabla no tenia donde guardarlo — sin esto no se puede saber que
-- pieza del Estudio de contenido genero una visita (link de seguimiento, ver /api/content/track/[itemId]).
alter table landing_events add column if not exists utm_content text;

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
    'page_view', 'click_booking', 'click_call', 'click_whatsapp', 'click_maps'
  ));

create index if not exists landing_events_location_key_idx on landing_events(location_key);
create index if not exists landing_events_utm_content_idx on landing_events(utm_content);
