-- Phase 1C: durable handler checkpoint and stale follow-up recovery.
-- Keeps the at-least-once transport from reinterpreting an already handled patient message when
-- only the final queue acknowledgement failed.

alter table whatsapp_webhook_events
  add column if not exists handler_completed_at timestamptz;

create or replace function checkpoint_whatsapp_webhook_handler(
  p_event_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(p_worker_id) < 1 or length(p_worker_id) > 200 then
    raise exception 'invalid_worker_id';
  end if;

  update whatsapp_webhook_events
  set handler_completed_at = coalesce(handler_completed_at, now()),
      phone = null,
      message_text = null,
      wa_name = null,
      button_id = null,
      referral = null,
      status_error_code = null,
      last_error = null
  where id = p_event_id
    and status = 'processing'
    and locked_by = p_worker_id;

  return found;
end;
$$;

-- Optional Supabase Cron recovery must enforce the same checkpoint invariant as the claim path.
-- Completed handlers are returned to ACK-only retry regardless of attempts; only incomplete
-- handlers can reach DLQ. Checkpointed envelopes have already been scrubbed by the function above.
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
  set status = case
        when handler_completed_at is not null then 'retry'
        when attempts >= 5 then 'dead_letter'
        else 'retry'
      end,
      available_at = now(),
      phone = case when handler_completed_at is null and attempts >= 5 then null else phone end,
      message_text = case when handler_completed_at is null and attempts >= 5 then null else message_text end,
      wa_name = case when handler_completed_at is null and attempts >= 5 then null else wa_name end,
      button_id = case when handler_completed_at is null and attempts >= 5 then null else button_id end,
      referral = case when handler_completed_at is null and attempts >= 5 then null else referral end,
      status_error_code = 'worker_lease_expired',
      locked_at = null,
      locked_by = null
  where status = 'processing' and locked_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  delete from whatsapp_conversation_leases where locked_until <= now();
  return v_count;
end;
$$;

-- A recovered row with a completed handler is an ACK-only retry. It must never consume another
-- handler attempt or be scrubbed/DLQ'd merely because the worker died before the final completion.
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

  update whatsapp_webhook_events
  set status = case
        when handler_completed_at is not null then 'retry'
        when attempts >= 5 then 'dead_letter'
        else 'retry'
      end,
      available_at = now(),
      phone = case when handler_completed_at is null and attempts >= 5 then null else phone end,
      message_text = case when handler_completed_at is null and attempts >= 5 then null else message_text end,
      wa_name = case when handler_completed_at is null and attempts >= 5 then null else wa_name end,
      button_id = case when handler_completed_at is null and attempts >= 5 then null else button_id end,
      referral = case when handler_completed_at is null and attempts >= 5 then null else referral end,
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
        attempts = case when handler_completed_at is null then attempts + 1 else attempts end,
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

-- Completion is valid only after the handler checkpoint. Retrying a failed completion therefore
-- claims a row that already carries handler_completed_at and the application skips the handler.
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
  where id = p_event_id
    and status = 'processing'
    and locked_by = p_worker_id
    and handler_completed_at is not null
  returning phone_hash into v_phone_hash;

  if v_phone_hash is null then return false; end if;
  delete from whatsapp_conversation_leases
  where phone_hash = v_phone_hash and worker_id = p_worker_id;
  return true;
end;
$$;

-- The application may have claimed the fifth attempt before it persisted the checkpoint. Once the
-- checkpoint exists, even a caller-provided permanent flag applies only to the ACK and cannot DLQ
-- or scrub an already handled patient event.
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

  v_dead_letter := v_event.handler_completed_at is null
    and (coalesce(p_permanent, false) or v_event.attempts >= 5);
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

-- A proactive follow-up has no safe automatic retry after its claim: the process may have reached
-- Meta before dying. Move old claims to the existing ambiguous outcome, which atomically pauses the
-- bot, marks the lead for human review and creates a technical handoff without patient content.
create or replace function recover_stale_whatsapp_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_count integer := 0;
begin
  for v_lead_id in
    select id
    from leads
    where origin_channel = 'whatsapp'
      and whatsapp_followup_status = 'dispatching'
      and coalesce(whatsapp_followup_claimed_at, updated_at, created_at)
        < now() - interval '15 minutes'
    order by coalesce(whatsapp_followup_claimed_at, updated_at, created_at), id
    limit 100
    for update skip locked
  loop
    if complete_whatsapp_followup(v_lead_id, 'ambiguous', now()) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function checkpoint_whatsapp_webhook_handler(uuid, text)
  from public, anon, authenticated;
revoke all on function claim_whatsapp_webhook_event(text, integer)
  from public, anon, authenticated;
revoke all on function complete_whatsapp_webhook_event(uuid, text)
  from public, anon, authenticated;
revoke all on function fail_whatsapp_webhook_event(uuid, text, text, boolean, integer)
  from public, anon, authenticated;
revoke all on function recover_stale_whatsapp_webhook_events()
  from public, anon, authenticated;
revoke all on function recover_stale_whatsapp_followups()
  from public, anon, authenticated;
grant execute on function checkpoint_whatsapp_webhook_handler(uuid, text) to service_role;
grant execute on function claim_whatsapp_webhook_event(text, integer) to service_role;
grant execute on function complete_whatsapp_webhook_event(uuid, text) to service_role;
grant execute on function fail_whatsapp_webhook_event(uuid, text, text, boolean, integer) to service_role;
grant execute on function recover_stale_whatsapp_webhook_events() to service_role;
grant execute on function recover_stale_whatsapp_followups() to service_role;
