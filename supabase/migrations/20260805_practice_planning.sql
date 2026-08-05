-- Planificación profesional editable que reemplaza el Google Sheet operativo.
-- No contiene datos de pacientes ni cobros reales: sólo agenda semanal, aranceles y feriados.
create table if not exists practice_planning (
  id text primary key,
  config jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_planning enable row level security;
alter table practice_planning force row level security;

drop policy if exists "staff_read_practice_planning" on practice_planning;
create policy "staff_read_practice_planning"
  on practice_planning for select to authenticated
  using (
    id = 'default'
    and security_role_allowed(array['owner','doctor'], false)
  );

drop policy if exists "clinical_staff_insert_practice_planning" on practice_planning;
create policy "clinical_staff_insert_practice_planning"
  on practice_planning for insert to authenticated
  with check (
    id = 'default'
    and security_role_allowed(array['owner','doctor'], true)
  );

drop policy if exists "clinical_staff_update_practice_planning" on practice_planning;
create policy "clinical_staff_update_practice_planning"
  on practice_planning for update to authenticated
  using (
    id = 'default'
    and security_role_allowed(array['owner','doctor'], true)
  )
  with check (
    id = 'default'
    and security_role_allowed(array['owner','doctor'], true)
  );

drop policy if exists "service_role_all_practice_planning" on practice_planning;
create policy "service_role_all_practice_planning"
  on practice_planning for all to service_role using (true) with check (true);

revoke all on table practice_planning from public, anon, authenticated;
grant select, insert, update on table practice_planning to authenticated;
grant select, insert, update, delete on table practice_planning to service_role;

drop trigger if exists practice_planning_updated_at on practice_planning;
create trigger practice_planning_updated_at
  before update on practice_planning
  for each row execute function update_updated_at_column();

insert into practice_planning (id, config)
values (
  'default',
  '{
    "version": 1,
    "intervals": [
      {"day":"monday","start":"09:00","end":"12:00","activity":"INVESTIGACION"},
      {"day":"monday","start":"12:00","end":"13:00","activity":"ALMUERZO"},
      {"day":"tuesday","start":"09:00","end":"12:00","activity":"INVESTIGACION"},
      {"day":"tuesday","start":"12:00","end":"13:00","activity":"ALMUERZO"},
      {"day":"wednesday","start":"09:00","end":"12:00","activity":"INVESTIGACION"},
      {"day":"wednesday","start":"12:00","end":"13:00","activity":"ALMUERZO"},
      {"day":"thursday","start":"09:00","end":"12:00","activity":"INVESTIGACION"},
      {"day":"thursday","start":"12:00","end":"13:00","activity":"ALMUERZO"},
      {"day":"friday","start":"09:00","end":"12:00","activity":"INVESTIGACION"},
      {"day":"friday","start":"12:00","end":"13:00","activity":"ALMUERZO"},
      {"day":"tuesday","start":"13:00","end":"15:00","activity":"CONSULTORIO CIMEL"},
      {"day":"tuesday","start":"16:00","end":"19:30","activity":"ECOCARDIOGRAMA HB LANUS"},
      {"day":"wednesday","start":"17:00","end":"19:45","activity":"CONSULTORIO HB CENTRAL"},
      {"day":"thursday","start":"13:00","end":"16:00","activity":"CONSULTORIO CIMEL"},
      {"day":"friday","start":"13:00","end":"16:00","activity":"CONSULTORIO CIMEL"},
      {"day":"friday","start":"17:00","end":"20:00","activity":"CONSULTORIO SMG"},
      {"day":"saturday","start":"09:00","end":"13:00","activity":"CERAMICA"}
    ],
    "rules": {
      "minutesPerPatient": 15,
      "privateConsultationValue": 60000,
      "coveredConsultationValue": 15000,
      "echocardiogramValue": 20000,
      "monthlyResearchValue": 0,
      "privatePatientsPerDay": 1,
      "averageWeeksPerMonth": 4.33
    },
    "holidays": ["2026-10-12","2026-11-23","2026-12-07","2026-12-08","2026-12-25"],
    "projectionStartMonth": "2026-09",
    "projectionMonths": 4
  }'::jsonb
)
on conflict (id) do nothing;
