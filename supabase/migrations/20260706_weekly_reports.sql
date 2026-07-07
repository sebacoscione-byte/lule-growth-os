-- Reportes automaticos semanales: snapshot de leads/conversion/canales generado por un cron
-- (/api/cron/weekly-report), sin depender de un canal de envio proactivo (WhatsApp/email) que hoy
-- no existe -- se puede ver en la app en vez de mandarse solo. Un registro por semana (upsert por
-- week_start si el cron se re-ejecuta la misma semana).

create table if not exists weekly_reports (
  id uuid default uuid_generate_v4() primary key,
  week_start date not null,
  week_end date not null,
  metrics jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists weekly_reports_week_start_idx on weekly_reports(week_start);

alter table weekly_reports enable row level security;

create policy "service_role_write_weekly_reports"
  on weekly_reports for all to service_role using (true) with check (true);

create policy "authenticated_read_weekly_reports"
  on weekly_reports for select to authenticated using (true);
