-- Bandeja de Instagram en modo observación. Guarda solamente el mínimo necesario para mostrar
-- DMs/comentarios y deduplicar reintentos de Meta; nunca conserva el payload crudo ni adjuntos.

create table if not exists public.instagram_inbox_items (
  id uuid primary key default uuid_generate_v4(),
  external_id text not null unique check (char_length(external_id) between 3 and 600),
  instagram_account_id text not null check (char_length(instagram_account_id) between 1 and 100),
  item_type text not null check (item_type in ('message', 'comment')),
  direction text not null check (direction in ('inbound', 'outbound')),
  participant_id text check (participant_id is null or char_length(participant_id) between 1 and 100),
  participant_username text check (
    participant_username is null or char_length(participant_username) between 1 and 100
  ),
  conversation_id text check (conversation_id is null or char_length(conversation_id) between 1 and 300),
  media_id text check (media_id is null or char_length(media_id) between 1 and 300),
  content text check (content is null or char_length(content) <= 4096),
  attachment_type text check (attachment_type is null or char_length(attachment_type) <= 80),
  occurred_at timestamptz not null,
  source text not null default 'webhook' check (source in ('webhook', 'api_backfill', 'export')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > occurred_at)
);

create index if not exists instagram_inbox_items_occurred_at_idx
  on public.instagram_inbox_items (occurred_at desc);
create index if not exists instagram_inbox_items_participant_idx
  on public.instagram_inbox_items (participant_id, occurred_at desc);
create index if not exists instagram_inbox_items_expires_at_idx
  on public.instagram_inbox_items (expires_at);

alter table public.instagram_inbox_items enable row level security;
alter table public.instagram_inbox_items force row level security;

drop policy if exists "service_role_all_instagram_inbox_items" on public.instagram_inbox_items;
create policy "service_role_all_instagram_inbox_items"
  on public.instagram_inbox_items for all to service_role using (true) with check (true);

revoke all on table public.instagram_inbox_items from public, anon, authenticated;
grant select, insert, update, delete on table public.instagram_inbox_items to service_role;

create or replace function public.run_instagram_inbox_retention(
  p_retention_days integer default 90
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint := 0;
begin
  p_retention_days := greatest(30, least(coalesce(p_retention_days, 90), 180));

  delete from public.instagram_inbox_items
  where expires_at <= clock_timestamp()
     or occurred_at < clock_timestamp() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke all on function public.run_instagram_inbox_retention(integer)
  from public, anon, authenticated;
grant execute on function public.run_instagram_inbox_retention(integer)
  to service_role;
