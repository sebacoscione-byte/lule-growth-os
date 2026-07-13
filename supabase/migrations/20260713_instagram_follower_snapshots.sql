-- ============================================================
-- Migración: snapshot diario de seguidores de Instagram
--
-- Hoy no hay ninguna forma de ver cuántos seguidores gana la cuenta por día -- Business Discovery
-- (para consultar otras cuentas) está confirmado que no existe en graph.instagram.com, pero el
-- propio conteo de la cuenta conectada (/me?fields=followers_count) sí es un campo normal de la
-- cuenta propia, no de Business Discovery, y ya tenemos el scope necesario
-- (instagram_business_manage_insights) cargado desde el 2026-07-10. Un registro por día (upsert por
-- captured_on si el cron se re-ejecuta el mismo día), tomado dentro del cron diario de
-- publish-content ya existente (no suma un cron job nuevo -- el plan Hobby de Vercel limita a 2).
-- ============================================================

create table if not exists instagram_follower_snapshots (
  id uuid default uuid_generate_v4() primary key,
  captured_on date not null,
  followers_count int not null,
  created_at timestamptz not null default now()
);

create unique index if not exists instagram_follower_snapshots_captured_on_idx
  on instagram_follower_snapshots(captured_on);

alter table instagram_follower_snapshots enable row level security;

create policy "service_role_write_instagram_follower_snapshots"
  on instagram_follower_snapshots for all to service_role using (true) with check (true);

create policy "authenticated_read_instagram_follower_snapshots"
  on instagram_follower_snapshots for select to authenticated using (true);
