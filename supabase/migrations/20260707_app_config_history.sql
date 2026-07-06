-- ============================================================
-- Historial de app_config: guarda el valor anterior de cada fila antes
-- de cualquier UPDATE, para poder recuperar datos si una migracion futura
-- (u otro bug) pisa una config sin querer.
--
-- Motivo: la migracion 20260707_hospital_britanico.sql hizo un
-- `update app_config set value = '[...]' where key = 'locations'` que
-- reemplazo toda la fila en vez de agregar solo la sede nueva, y borro
-- campos ya cargados (whatsapp propio de Swiss Medical, telefonos,
-- horarios, obras sociales, notas) sin dejar rastro para recuperarlos.
-- ============================================================

create table if not exists app_config_history (
  id uuid default uuid_generate_v4() primary key,
  key text not null,
  value jsonb not null,
  changed_at timestamptz not null default now()
);

create index if not exists app_config_history_key_idx on app_config_history(key, changed_at desc);

alter table app_config_history enable row level security;

create policy "authenticated_read_app_config_history"
  on app_config_history for select to authenticated using (true);

create or replace function log_app_config_change() returns trigger as $$
begin
  insert into app_config_history (key, value) values (old.key, old.value);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists app_config_before_update on app_config;

create trigger app_config_before_update
  before update on app_config
  for each row execute function log_app_config_change();
