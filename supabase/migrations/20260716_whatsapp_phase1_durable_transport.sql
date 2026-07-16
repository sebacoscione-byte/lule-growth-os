-- Phase 1: durable WhatsApp transport.
-- The webhook persists a minimal normalized envelope and returns 200 before patient processing.
-- No raw Meta payload or media id is stored. Phone/name/text are scrubbed after success or DLQ.

create extension if not exists pgcrypto;

alter table whatsapp_webhook_events
  drop constraint if exists whatsapp_webhook_events_status_check;

alter table whatsapp_webhook_events
  add column if not exists event_type text not null default 'inbound',
  add column if not exists related_wa_message_id text,
  add column if not exists phone_hash text,
  add column if not exists message_type text,
  add column if not exists message_text text,
  add column if not exists wa_name text,
  add column if not exists button_id text,
  add column if not exists referral jsonb,
  add column if not exists delivery_status text,
  add column if not exists status_error_code text,
  add column if not exists occurred_at timestamptz,
  add column if not exists batch_order integer not null default 0,
  add column if not exists attempts integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists alerted_at timestamptz;

update whatsapp_webhook_events
set
  status = case status
    when 'processing' then 'pending'
    when 'failed_transient' then 'retry'
    when 'failed_permanent' then 'dead_letter'
    else status
  end,
  related_wa_message_id = coalesce(related_wa_message_id, wa_message_id),
  phone_hash = coalesce(phone_hash, encode(digest(coalesce(phone, wa_message_id), 'sha256'), 'hex')),
  status_error_code = case
    when last_error is not null then coalesce(status_error_code, 'legacy_error_redacted')
    else status_error_code
  end,
  phone = case
    when status in ('processed', 'failed_permanent', 'dead_letter') then null
    else phone
  end,
  last_error = null;

alter table whatsapp_webhook_events alter column status set default 'pending';
alter table whatsapp_webhook_events alter column related_wa_message_id set not null;
alter table whatsapp_webhook_events alter column phone_hash set not null;

alter table whatsapp_webhook_events
  add constraint whatsapp_webhook_events_status_check
    check (status in ('pending', 'processing', 'processed', 'retry', 'dead_letter')),
  add constraint whatsapp_webhook_events_event_type_check
    check (event_type in ('inbound', 'status')),
  add constraint whatsapp_webhook_events_phone_hash_check
    check (phone_hash ~ '^[0-9a-f]{64}$'),
  add constraint whatsapp_webhook_events_attempts_check
    check (attempts between 0 and 100),
  add constraint whatsapp_webhook_events_batch_order_check
    check (batch_order between 0 and 10000),
  add constraint whatsapp_webhook_events_delivery_status_check
    check (delivery_status is null or delivery_status in ('sent', 'delivered', 'read', 'failed', 'deleted', 'warning'));

drop index if exists whatsapp_webhook_events_status_idx;
create index if not exists whatsapp_webhook_events_due_idx
  on whatsapp_webhook_events(status, available_at, created_at)
  where status in ('pending', 'retry');
create index if not exists whatsapp_webhook_events_phone_order_idx
  on whatsapp_webhook_events(phone_hash, occurred_at, created_at, batch_order)
  where status in ('pending', 'retry', 'processing');

-- Old authenticated visibility exposed phone numbers and provider errors. Queue access is backend-only.
drop policy if exists "authenticated_read_whatsapp_webhook_events" on whatsapp_webhook_events;
drop policy if exists "service_role_all_whatsapp_webhook_events" on whatsapp_webhook_events;
create policy "service_role_all_whatsapp_webhook_events"
  on whatsapp_webhook_events for all to service_role using (true) with check (true);

create table if not exists whatsapp_conversation_leases (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  worker_id text not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table whatsapp_conversation_leases enable row level security;
drop policy if exists "service_role_all_whatsapp_conversation_leases" on whatsapp_conversation_leases;
create policy "service_role_all_whatsapp_conversation_leases"
  on whatsapp_conversation_leases for all to service_role using (true) with check (true);

-- One normalized audit row per delivery transition, without patient content or phone number.
create table if not exists whatsapp_message_status_events (
  id uuid primary key default uuid_generate_v4(),
  wa_message_id text not null,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed', 'deleted', 'warning')),
  occurred_at timestamptz not null,
  error_code text,
  created_at timestamptz not null default now(),
  unique (wa_message_id, status, occurred_at)
);

alter table whatsapp_message_status_events enable row level security;
drop policy if exists "service_role_all_whatsapp_message_status_events" on whatsapp_message_status_events;
create policy "service_role_all_whatsapp_message_status_events"
  on whatsapp_message_status_events for all to service_role using (true) with check (true);

alter table messages
  add column if not exists delivery_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists delivery_error_code text;

alter table whatsapp_cost_events
  add column if not exists wa_message_id text,
  add column if not exists delivery_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists delivery_error_code text;

-- Meta message IDs are globally stable. Remove historical retry duplicates once, then make every
-- inbound/outbound log idempotent by provider ID.
delete from messages m
using messages duplicate
where m.wa_message_id is not null
  and m.wa_message_id = duplicate.wa_message_id
  and m.id > duplicate.id;

delete from whatsapp_cost_events e
using whatsapp_cost_events duplicate
where e.wa_message_id is not null
  and e.wa_message_id = duplicate.wa_message_id
  and e.id > duplicate.id;

drop index if exists whatsapp_cost_events_wa_message_id_idx;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_cost_events_wa_message_id_unique'
  ) then
    alter table whatsapp_cost_events
      add constraint whatsapp_cost_events_wa_message_id_unique unique (wa_message_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'messages_wa_message_id_unique'
  ) then
    alter table messages
      add constraint messages_wa_message_id_unique unique (wa_message_id);
  end if;
end $$;

-- Claims exactly one event and leases its phone hash. Concurrent workers can process different
-- conversations, but never two events from the same conversation at the same time.
create or replace function claim_whatsapp_webhook_event(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof whatsapp_webhook_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone_hash text;
  v_leased_hash text;
  v_event whatsapp_webhook_events%rowtype;
begin
  if p_worker_id is null or length(p_worker_id) < 1 or length(p_worker_id) > 200 then
    raise exception 'invalid_worker_id';
  end if;
  p_lease_seconds := greatest(15, least(coalesce(p_lease_seconds, 120), 600));

  -- Recover interrupted invocations after their lease has certainly expired.
  update whatsapp_webhook_events
  set status = case when attempts >= 5 then 'dead_letter' else 'retry' end,
      available_at = now(),
      phone = case when attempts >= 5 then null else phone end,
      message_text = case when attempts >= 5 then null else message_text end,
      wa_name = case when attempts >= 5 then null else wa_name end,
      button_id = case when attempts >= 5 then null else button_id end,
      referral = case when attempts >= 5 then null else referral end,
      status_error_code = 'worker_lease_expired',
      locked_at = null,
      locked_by = null
  where status = 'processing' and locked_at < now() - interval '10 minutes';
  delete from whatsapp_conversation_leases where locked_until <= now();

  for v_phone_hash in
    select head.phone_hash
    from (
      select distinct on (q.phone_hash)
        q.phone_hash, q.status, q.available_at, coalesce(q.occurred_at, q.created_at) as sort_at
      from whatsapp_webhook_events q
      where q.status in ('pending', 'retry', 'processing')
      order by q.phone_hash, coalesce(q.occurred_at, q.created_at), q.created_at, q.batch_order, q.id
    ) head
    where head.status in ('pending', 'retry') and head.available_at <= now()
    order by head.sort_at
    limit 50
  loop
    v_leased_hash := null;
    insert into whatsapp_conversation_leases(phone_hash, worker_id, locked_until, updated_at)
    values (v_phone_hash, p_worker_id, now() + make_interval(secs => p_lease_seconds), now())
    on conflict (phone_hash) do update
      set worker_id = excluded.worker_id,
          locked_until = excluded.locked_until,
          updated_at = now()
      where whatsapp_conversation_leases.locked_until <= now()
    returning phone_hash into v_leased_hash;

    if v_leased_hash is null then
      continue;
    end if;

    update whatsapp_webhook_events
    set status = 'processing',
        attempts = attempts + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        last_error = null
    where id = (
      select q.id
      from whatsapp_webhook_events q
      where q.phone_hash = v_phone_hash
        and q.status in ('pending', 'retry')
        and q.available_at <= now()
      order by coalesce(q.occurred_at, q.created_at), q.created_at, q.batch_order, q.id
      limit 1
      for update skip locked
    )
    returning * into v_event;

    if found then
      return next v_event;
      return;
    end if;

    delete from whatsapp_conversation_leases
    where phone_hash = v_phone_hash and worker_id = p_worker_id;
  end loop;
  return;
end;
$$;

create or replace function complete_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone_hash text;
begin
  update whatsapp_webhook_events
  set status = 'processed',
      processed_at = now(),
      phone = null,
      message_text = null,
      wa_name = null,
      button_id = null,
      referral = null,
      status_error_code = null,
      locked_at = null,
      locked_by = null,
      last_error = null
  where id = p_event_id and status = 'processing' and locked_by = p_worker_id
  returning phone_hash into v_phone_hash;

  if v_phone_hash is null then return false; end if;
  delete from whatsapp_conversation_leases
  where phone_hash = v_phone_hash and worker_id = p_worker_id;
  return true;
end;
$$;

create or replace function fail_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_permanent boolean,
  p_retry_delay_seconds integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event whatsapp_webhook_events%rowtype;
  v_dead_letter boolean;
begin
  select * into v_event
  from whatsapp_webhook_events
  where id = p_event_id and status = 'processing' and locked_by = p_worker_id
  for update;
  if not found then raise exception 'event_not_claimed'; end if;

  v_dead_letter := coalesce(p_permanent, false) or v_event.attempts >= 5;
  update whatsapp_webhook_events
  set status = case when v_dead_letter then 'dead_letter' else 'retry' end,
      available_at = case when v_dead_letter then available_at
        else now() + make_interval(secs => greatest(1, least(coalesce(p_retry_delay_seconds, 5), 900))) end,
      last_error = null,
      status_error_code = left(coalesce(p_error_code, 'internal_error'), 80),
      phone = case when v_dead_letter then null else phone end,
      message_text = case when v_dead_letter then null else message_text end,
      wa_name = case when v_dead_letter then null else wa_name end,
      button_id = case when v_dead_letter then null else button_id end,
      referral = case when v_dead_letter then null else referral end,
      locked_at = null,
      locked_by = null
  where id = p_event_id;

  delete from whatsapp_conversation_leases
  where phone_hash = v_event.phone_hash and worker_id = p_worker_id;
  return case when v_dead_letter then 'dead_letter' else 'retry' end;
end;
$$;

-- Applies delivery transitions without regressing a read message back to delivered/sent when Meta
-- sends status notifications out of order.
create or replace function apply_whatsapp_delivery_status(
  p_wa_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_new_rank integer;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed', 'deleted', 'warning') then
    raise exception 'invalid_delivery_status';
  end if;
  v_new_rank := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;

  insert into whatsapp_message_status_events(wa_message_id, status, occurred_at, error_code)
  values (p_wa_message_id, p_status, v_occurred_at, left(p_error_code, 80))
  on conflict (wa_message_id, status, occurred_at) do nothing;

  update messages
  set delivery_status = case
        -- Failure is recorded as its own milestone. It never overwrites proof of delivery/read.
        when p_status = 'failed' then case when delivery_status in ('delivered', 'read') then delivery_status else 'failed' end
        when p_status in ('deleted', 'warning') then coalesce(delivery_status, p_status)
        when v_new_rank >= case delivery_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end
          then p_status else delivery_status end,
      delivered_at = case when p_status in ('delivered', 'read') then least(coalesce(delivered_at, v_occurred_at), v_occurred_at) else delivered_at end,
      read_at = case when p_status = 'read' then least(coalesce(read_at, v_occurred_at), v_occurred_at) else read_at end,
      failed_at = case when p_status = 'failed' then least(coalesce(failed_at, v_occurred_at), v_occurred_at) else failed_at end,
      delivery_error_code = case when p_status = 'failed' then left(p_error_code, 80) else delivery_error_code end
  where wa_message_id = p_wa_message_id;

  update whatsapp_cost_events
  set delivery_status = case
        when p_status = 'failed' then case when delivery_status in ('delivered', 'read') then delivery_status else 'failed' end
        when p_status in ('deleted', 'warning') then coalesce(delivery_status, p_status)
        when v_new_rank >= case delivery_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end
          then p_status else delivery_status end,
      delivered_at = case when p_status in ('delivered', 'read') then least(coalesce(delivered_at, v_occurred_at), v_occurred_at) else delivered_at end,
      read_at = case when p_status = 'read' then least(coalesce(read_at, v_occurred_at), v_occurred_at) else read_at end,
      failed_at = case when p_status = 'failed' then least(coalesce(failed_at, v_occurred_at), v_occurred_at) else failed_at end,
      delivery_error_code = case when p_status = 'failed' then left(p_error_code, 80) else delivery_error_code end
  where wa_message_id = p_wa_message_id;
end;
$$;

-- Delivery webhooks may arrive before the application finishes logging an accepted send. Reapply
-- the durable transitions after the log write so neither arrival order loses status information.
create or replace function reconcile_whatsapp_delivery_status(p_wa_message_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  for v_event in
    select status, occurred_at, error_code
    from whatsapp_message_status_events
    where wa_message_id = p_wa_message_id
    order by occurred_at, created_at, id
  loop
    perform apply_whatsapp_delivery_status(
      p_wa_message_id, v_event.status, v_event.occurred_at, v_event.error_code
    );
  end loop;
end;
$$;

-- Safe target for an optional Supabase Cron SQL job (for example every 5 minutes). It only
-- recovers expired leases; actual patient processing remains in the authenticated app worker.
-- The schedule is intentionally not created here because project-level Cron availability and
-- ownership are external configuration, and no URL/credential should be hardcoded in a migration.
create or replace function recover_stale_whatsapp_webhook_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update whatsapp_webhook_events
  set status = case when attempts >= 5 then 'dead_letter' else 'retry' end,
      available_at = now(),
      phone = case when attempts >= 5 then null else phone end,
      message_text = case when attempts >= 5 then null else message_text end,
      wa_name = case when attempts >= 5 then null else wa_name end,
      button_id = case when attempts >= 5 then null else button_id end,
      referral = case when attempts >= 5 then null else referral end,
      status_error_code = 'worker_lease_expired',
      locked_at = null,
      locked_by = null
  where status = 'processing' and locked_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  delete from whatsapp_conversation_leases where locked_until <= now();
  return v_count;
end;
$$;

-- Reclama una sola vez las alertas nuevas de DLQ sin revelar filas ni PII al proceso de alertas.
create or replace function claim_whatsapp_dead_letter_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update whatsapp_webhook_events
  set alerted_at = now()
  where status = 'dead_letter' and alerted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function claim_whatsapp_webhook_event(text, integer) from public, anon, authenticated;
revoke all on function complete_whatsapp_webhook_event(uuid, text) from public, anon, authenticated;
revoke all on function fail_whatsapp_webhook_event(uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function apply_whatsapp_delivery_status(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function reconcile_whatsapp_delivery_status(text) from public, anon, authenticated;
revoke all on function recover_stale_whatsapp_webhook_events() from public, anon, authenticated;
revoke all on function claim_whatsapp_dead_letter_alerts() from public, anon, authenticated;
grant execute on function claim_whatsapp_webhook_event(text, integer) to service_role;
grant execute on function complete_whatsapp_webhook_event(uuid, text) to service_role;
grant execute on function fail_whatsapp_webhook_event(uuid, text, text, boolean, integer) to service_role;
grant execute on function apply_whatsapp_delivery_status(text, text, timestamptz, text) to service_role;
grant execute on function reconcile_whatsapp_delivery_status(text) to service_role;
grant execute on function recover_stale_whatsapp_webhook_events() to service_role;
grant execute on function claim_whatsapp_dead_letter_alerts() to service_role;
