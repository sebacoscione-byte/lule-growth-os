-- Hospital Británico Lanús y Central comparten institución/canal, no sede física.
-- Conservamos `britanico` para los eventos históricos y clientes anteriores al despliegue.
alter table landing_events
  drop constraint if exists landing_events_location_key_check;

alter table landing_events
  add constraint landing_events_location_key_check
  check (
    location_key is null
    or location_key in (
      'cimel', 'swiss', 'britanico', 'britanico_lanus', 'britanico_central'
    )
  );
