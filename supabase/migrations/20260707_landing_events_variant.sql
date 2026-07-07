-- landing_events: columna variant + eventos de click en los botones del hero.
-- Primer test A/B real de la landing (variante de orden/enfasis de los CTAs del hero en
-- /dra-lucia-chahin, asignada 50/50 por cookie en middleware.ts). Sin esta columna no se puede
-- saber que variante vio cada visitante, ni comparar su tasa de interaccion.

alter table landing_events add column if not exists variant text
  check (variant is null or variant in ('a', 'b'));

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
    'click_hero_primary', 'click_hero_secondary'
  ));

create index if not exists landing_events_variant_idx on landing_events(variant);
