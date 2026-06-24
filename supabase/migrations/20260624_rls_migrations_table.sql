-- Enable RLS on _migrations tracking table (created by migration runner)
-- The runner connects as postgres (superuser) so RLS does not block it.
-- This prevents anon/authenticated roles from reading or writing migration history.

alter table if exists _migrations enable row level security;

create policy "authenticated_read_migrations"
  on _migrations for select to authenticated using (true);
