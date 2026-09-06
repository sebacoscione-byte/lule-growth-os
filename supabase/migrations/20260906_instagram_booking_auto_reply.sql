-- Respuesta administrativa de turnos en Instagram. La tabla funciona como ledger/outbox:
-- deduplica reintentos del webhook, aplica cooldown y nunca almacena payloads crudos ni tokens.

create table if not exists public.instagram_auto_reply_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.instagram_auto_reply_settings (id, enabled)
values (true, true)
on conflict (id) do nothing;

create table if not exists public.instagram_auto_replies (
  id uuid primary key default uuid_generate_v4(),
  source_external_id text not null unique check (char_length(source_external_id) between 3 and 600),
  instagram_account_id text not null check (char_length(instagram_account_id) between 1 and 100),
  participant_id text not null check (char_length(participant_id) between 1 and 100),
  source_type text not null check (source_type in ('message', 'comment')),
  target_id text not null check (char_length(target_id) between 1 and 600),
  reply_text text not null check (char_length(reply_text) between 1 and 1000),
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'failed', 'indeterminate')),
  meta_message_id text check (meta_message_id is null or char_length(meta_message_id) <= 600),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists instagram_auto_replies_participant_created_idx
  on public.instagram_auto_replies (instagram_account_id, participant_id, created_at desc);
create index if not exists instagram_auto_replies_expires_at_idx
  on public.instagram_auto_replies (expires_at);

alter table public.instagram_auto_reply_settings enable row level security;
alter table public.instagram_auto_reply_settings force row level security;
alter table public.instagram_auto_replies enable row level security;
alter table public.instagram_auto_replies force row level security;

drop policy if exists "service_role_all_instagram_auto_reply_settings"
  on public.instagram_auto_reply_settings;
create policy "service_role_all_instagram_auto_reply_settings"
  on public.instagram_auto_reply_settings for all to service_role using (true) with check (true);

drop policy if exists "service_role_all_instagram_auto_replies"
  on public.instagram_auto_replies;
create policy "service_role_all_instagram_auto_replies"
  on public.instagram_auto_replies for all to service_role using (true) with check (true);

revoke all on table public.instagram_auto_reply_settings from public, anon, authenticated;
revoke all on table public.instagram_auto_replies from public, anon, authenticated;
grant select, insert, update on table public.instagram_auto_reply_settings to service_role;
grant select, insert, update, delete on table public.instagram_auto_replies to service_role;

create or replace function public.claim_instagram_booking_auto_reply(
  p_source_external_id text,
  p_instagram_account_id text,
  p_participant_id text,
  p_source_type text,
  p_target_id text,
  p_reply_text text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_source_external_id is null or char_length(p_source_external_id) not between 3 and 600
     or p_instagram_account_id is null or char_length(p_instagram_account_id) not between 1 and 100
     or p_participant_id is null or char_length(p_participant_id) not between 1 and 100
     or p_source_type not in ('message', 'comment')
     or p_target_id is null or char_length(p_target_id) not between 1 and 600
     or p_reply_text is null or char_length(p_reply_text) not between 1 and 1000 then
    raise exception 'invalid_instagram_auto_reply_claim';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'instagram-auto-reply:' || p_instagram_account_id || ':' || p_participant_id,
    0
  ));

  if exists (
    select 1 from public.instagram_auto_replies
    where source_external_id = p_source_external_id
  ) then
    return null;
  end if;

  if exists (
    select 1 from public.instagram_auto_replies
    where instagram_account_id = p_instagram_account_id
      and participant_id = p_participant_id
      and created_at >= clock_timestamp() - interval '24 hours'
      and status in ('processing', 'sent', 'indeterminate')
  ) then
    return null;
  end if;

  insert into public.instagram_auto_replies (
    source_external_id,
    instagram_account_id,
    participant_id,
    source_type,
    target_id,
    reply_text
  ) values (
    p_source_external_id,
    p_instagram_account_id,
    p_participant_id,
    p_source_type,
    p_target_id,
    p_reply_text
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_instagram_booking_auto_reply(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_instagram_booking_auto_reply(text, text, text, text, text, text)
  to service_role;

-- Conserva la misma barrida semanal; no agrega un tercer cron de Vercel.
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

  delete from public.instagram_auto_replies
  where expires_at <= clock_timestamp()
     or created_at < clock_timestamp() - make_interval(days => p_retention_days);

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
