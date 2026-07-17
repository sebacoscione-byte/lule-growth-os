-- Los mensajes existentes conservan su ciclo normal. Solamente el texto recibido mientras una
-- persona atiende el handoff se etiqueta para borrado temprano.
alter table public.messages
  add column if not exists retention_class text not null default 'standard';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_retention_class_check'
  ) then
    alter table public.messages
      add constraint messages_retention_class_check
      check (retention_class in ('standard', 'handoff_transient'));
  end if;
end;
$$;

create index if not exists messages_handoff_transient_created_at_idx
  on public.messages (created_at)
  where retention_class = 'handoff_transient';

-- Se invoca desde la barrida semanal ya existente. No crea un cron adicional.
create or replace function run_whatsapp_handoff_message_retention(
  p_retention_days integer default 30
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint := 0;
begin
  p_retention_days := greatest(1, least(coalesce(p_retention_days, 30), 90));

  delete from public.messages
  where retention_class = 'handoff_transient'
    and created_at < clock_timestamp() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke all on function run_whatsapp_handoff_message_retention(integer)
  from public, anon, authenticated;
grant execute on function run_whatsapp_handoff_message_retention(integer)
  to service_role;
