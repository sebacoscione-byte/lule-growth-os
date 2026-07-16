-- Phase 1E: erasure suppression for in-flight workers and Meta redeliveries.
--
-- Phone HMACs are retained for 90 days, but block generic writes for only 15 minutes. Queue events
-- additionally compare their provider timestamp with erased_at, so a previously unseen old Meta
-- delivery stays suppressed while a genuinely new conversation can start after the short window.
-- Stable Meta event/outbound identifiers are also tombstoned for 90 days.
-- No raw phone or provider id is stored: identifiers are HMACed with a database-local random key.

create extension if not exists pgcrypto;

create table if not exists whatsapp_erasure_secret (
  id text primary key check (id = 'global'),
  secret bytea not null check (octet_length(secret) = 32),
  created_at timestamptz not null default now()
);

insert into whatsapp_erasure_secret(id, secret)
values ('global', gen_random_bytes(32))
on conflict (id) do nothing;

alter table whatsapp_erasure_secret enable row level security;
alter table whatsapp_erasure_secret force row level security;
revoke all on table whatsapp_erasure_secret from public, anon, authenticated, service_role;

create table if not exists whatsapp_erasure_tombstones (
  kind text not null check (kind in ('phone', 'event', 'outbound')),
  identifier_hmac text not null check (identifier_hmac ~ '^[0-9a-f]{64}$'),
  -- Only phone tombstones need compatibility with existing SHA-256 partition/cost hashes.
  -- This remains service-role-only pseudonymous data, never anonymous data.
  lookup_hash text check (lookup_hash is null or lookup_hash ~ '^[0-9a-f]{64}$'),
  erased_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (kind, identifier_hmac)
);

create index if not exists whatsapp_erasure_tombstones_lookup_idx
  on whatsapp_erasure_tombstones(kind, lookup_hash, expires_at)
  where lookup_hash is not null;
create index if not exists whatsapp_erasure_tombstones_expiry_idx
  on whatsapp_erasure_tombstones(expires_at);

alter table whatsapp_erasure_tombstones enable row level security;
alter table whatsapp_erasure_tombstones force row level security;
drop policy if exists "service_role_all_whatsapp_erasure_tombstones" on whatsapp_erasure_tombstones;
create policy "service_role_all_whatsapp_erasure_tombstones"
  on whatsapp_erasure_tombstones for all to service_role using (true) with check (true);
revoke all on table whatsapp_erasure_tombstones from public, anon, authenticated;
grant select, insert, update, delete on table whatsapp_erasure_tombstones to service_role;

create or replace function whatsapp_erasure_identifier_hmac(p_kind text, p_identifier text)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_secret bytea;
begin
  select secret into v_secret from whatsapp_erasure_secret where id = 'global';
  if v_secret is null then raise exception 'whatsapp_erasure_secret_unavailable'; end if;
  return encode(
    hmac(
      convert_to(p_kind || ':' || p_identifier, 'UTF8'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
end;
$$;

create or replace function is_whatsapp_erasure_identifier_suppressed(
  p_kind text,
  p_identifier text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_kind not in ('phone', 'event', 'outbound')
      or nullif(p_identifier, '') is null
      or length(p_identifier) > 1024 then false
    else exists (
      select 1 from whatsapp_erasure_tombstones t
      where t.kind = p_kind
        and t.identifier_hmac = whatsapp_erasure_identifier_hmac(p_kind, p_identifier)
        and t.expires_at > now()
        and (t.kind <> 'phone' or t.erased_at > now() - interval '15 minutes')
    )
  end;
$$;

create or replace function create_whatsapp_erasure_tombstone(
  p_kind text,
  p_identifier text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expiry timestamptz;
begin
  if p_kind not in ('phone', 'event', 'outbound')
    or nullif(p_identifier, '') is null
    or length(p_identifier) > 1024 then
    raise exception 'invalid_erasure_tombstone';
  end if;
  if p_kind = 'phone' and p_identifier !~ '^[0-9]{6,20}$' then
    raise exception 'invalid_erasure_phone';
  end if;

  -- Stable evidence can be written without a phone column. Serialize its tombstone with every
  -- evidence/status/outbox trigger that checks the same identifier.
  if p_kind in ('event', 'outbound') then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure-id:' || p_kind || ':' || p_identifier, 0
    ));
  end if;

  v_expiry := now() + interval '90 days';
  insert into whatsapp_erasure_tombstones(
    kind, identifier_hmac, lookup_hash, erased_at, expires_at
  ) values (
    p_kind,
    whatsapp_erasure_identifier_hmac(p_kind, p_identifier),
    case when p_kind = 'phone' then encode(digest(p_identifier, 'sha256'), 'hex') else null end,
    now(),
    v_expiry
  )
  on conflict (kind, identifier_hmac) do update
  set erased_at = now(),
      lookup_hash = excluded.lookup_hash,
      expires_at = greatest(whatsapp_erasure_tombstones.expires_at, excluded.expires_at);
end;
$$;

create or replace function is_whatsapp_erasure_suppressed(
  p_phone text,
  p_source_key text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (
      coalesce(p_phone, '') ~ '^[0-9]{6,20}$'
      and is_whatsapp_erasure_identifier_suppressed('phone', p_phone)
    )
    or (
      nullif(p_source_key, '') is not null
      and is_whatsapp_erasure_identifier_suppressed('event', p_source_key)
    );
$$;

-- Provider timestamps distinguish an old delivery that Meta had not yet delivered at erasure time
-- from a message the person intentionally sends afterwards.
create or replace function is_whatsapp_erasure_event_suppressed(
  p_phone text,
  p_source_key text,
  p_occurred_at timestamptz
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    is_whatsapp_erasure_identifier_suppressed('event', p_source_key)
    or (
      coalesce(p_phone, '') ~ '^[0-9]{6,20}$'
      and exists (
        select 1 from whatsapp_erasure_tombstones t
        where t.kind = 'phone'
          and t.identifier_hmac = whatsapp_erasure_identifier_hmac('phone', p_phone)
          and t.expires_at > now()
          and (
            t.erased_at > now() - interval '15 minutes'
            or (p_occurred_at is not null and p_occurred_at <= t.erased_at)
          )
      )
    );
$$;

-- The stable wrapper now checks suppression itself, so every direct service-role caller is safe,
-- not only the TypeScript bot path.
create or replace function ensure_whatsapp_lead(
  p_phone text,
  p_name text default null,
  p_status text default 'interesado',
  p_possible_emergency boolean default false,
  p_requires_human boolean default false,
  p_source_wa_message_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_whatsapp_erasure_suppressed(p_phone, p_source_wa_message_id) then
    raise exception 'whatsapp_erasure_suppressed';
  end if;
  return ensure_whatsapp_lead_core(
    p_phone, p_name, p_status, p_possible_emergency, p_requires_human, p_source_wa_message_id
  );
end;
$$;

-- Queue inserts for an erased Meta event become an intentional no-op. This is the final atomic
-- protection for the check/insert race in the webhook process.
create or replace function suppress_erased_whatsapp_queue_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize the insert with erasure for the same destination. Without this lock, an uncommitted
  -- insert could pass the tombstone check, be missed by the erasure SELECT, and commit afterwards.
  if new.phone_hash ~ '^[0-9a-f]{64}$' then
    perform pg_advisory_xact_lock(hashtextextended('whatsapp-erasure:' || new.phone_hash, 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'whatsapp-erasure-id:event:' || new.wa_message_id, 0
  ));
  if new.related_wa_message_id <> new.wa_message_id then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure-id:event:' || new.related_wa_message_id, 0
    ));
  end if;
  if is_whatsapp_erasure_event_suppressed(
      new.phone, new.wa_message_id, coalesce(new.occurred_at, '1970-01-01'::timestamptz)
    )
    or is_whatsapp_erasure_event_suppressed(
      new.phone, new.related_wa_message_id, coalesce(new.occurred_at, '1970-01-01'::timestamptz)
    ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists suppress_erased_whatsapp_queue_insert on whatsapp_webhook_events;
create trigger suppress_erased_whatsapp_queue_insert
  before insert on whatsapp_webhook_events
  for each row execute function suppress_erased_whatsapp_queue_insert();

create or replace function complete_erased_whatsapp_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_source_key text,
  p_related_source_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event whatsapp_webhook_events%rowtype;
begin
  select * into v_event
  from whatsapp_webhook_events
  where id = p_event_id and status = 'processing' and locked_by = p_worker_id;

  if found then
    if v_event.wa_message_id is distinct from p_source_key
      or v_event.related_wa_message_id is distinct from p_related_source_key then
      raise exception 'erasure_event_identity_mismatch';
    end if;
    if not (
      is_whatsapp_erasure_identifier_suppressed('event', v_event.wa_message_id)
      or is_whatsapp_erasure_identifier_suppressed('event', v_event.related_wa_message_id)
    ) then
      raise exception 'erasure_tombstone_required';
    end if;
    delete from whatsapp_webhook_events
    where id = p_event_id and status = 'processing' and locked_by = p_worker_id;
    delete from whatsapp_conversation_leases
    where phone_hash = v_event.phone_hash and worker_id = p_worker_id;
  elsif not (
    is_whatsapp_erasure_identifier_suppressed('event', p_source_key)
    or is_whatsapp_erasure_identifier_suppressed('event', p_related_source_key)
  ) then
    raise exception 'erasure_tombstone_required';
  end if;
  -- The erasure transaction may already have deleted the row; the durable tombstone still makes
  -- that an idempotent success.
  return true;
end;
$$;

-- A short phone tombstone prevents a worker already in memory from recreating a lead/session or
-- consent row after the erasure transaction commits.
create or replace function block_erased_whatsapp_contact_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_old_phone text;
  v_new_phone text;
begin
  v_new_phone := case
    when tg_table_name = 'consent_records' then to_jsonb(new)->>'wa_id'
    else to_jsonb(new)->>'phone'
  end;
  v_old_phone := case when tg_op = 'UPDATE' then
    case
      when tg_table_name = 'consent_records' then to_jsonb(old)->>'wa_id'
      else to_jsonb(old)->>'phone'
    end
  else null end;

  -- Lock OLD and NEW in a deterministic order. Otherwise an UPDATE A->B could escape an erasure
  -- that had already selected A but had not yet deleted the contact-bearing row.
  for v_phone in
    select distinct phone
    from unnest(array[v_old_phone, v_new_phone]) as candidates(phone)
    where phone ~ '^[0-9]{6,20}$'
    order by phone
  loop
    -- All contact-bearing writes use the same partition lock as erase_lead(). Either the write
    -- commits first and is removed, or it waits and observes the durable tombstone.
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure:' || encode(digest(v_phone, 'sha256'), 'hex'), 0
    ));
    if is_whatsapp_erasure_identifier_suppressed('phone', v_phone) then
      raise exception 'whatsapp_erasure_suppressed';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists block_erased_whatsapp_lead_write on leads;
create trigger block_erased_whatsapp_lead_write
  before insert or update of phone on leads
  for each row execute function block_erased_whatsapp_contact_write();
drop trigger if exists block_erased_whatsapp_session_write on whatsapp_sessions;
create trigger block_erased_whatsapp_session_write
  before insert or update of phone on whatsapp_sessions
  for each row execute function block_erased_whatsapp_contact_write();
drop trigger if exists block_erased_whatsapp_consent_contact_write on consent_records;
create trigger block_erased_whatsapp_consent_contact_write
  before insert or update of wa_id on consent_records
  for each row execute function block_erased_whatsapp_contact_write();

-- Evidence/ledger tombstones close writes which do not carry a raw phone (messages, handoffs and
-- pseudonymized cost rows). New clinical/admin content is never copied into the tombstone table.
create or replace function block_erased_whatsapp_evidence_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_key text;
  v_outbound_key text;
  v_phone_hash text;
begin
  v_event_key := case tg_table_name
    when 'consent_records' then to_jsonb(new)->>'evidence_message_id'
    when 'handoff_events' then to_jsonb(new)->>'source_wa_message_id'
    else to_jsonb(new)->>'wa_message_id'
  end;
  v_outbound_key := to_jsonb(new)->>'outbound_ledger_key';
  if tg_table_name = 'whatsapp_cost_events' then v_phone_hash := to_jsonb(new)->>'wa_id'; end if;

  if coalesce(v_phone_hash, '') ~ '^[0-9a-f]{64}$' then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure:' || v_phone_hash, 0
    ));
  end if;
  if nullif(v_event_key, '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure-id:event:' || v_event_key, 0
    ));
  end if;
  if nullif(v_outbound_key, '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure-id:outbound:' || v_outbound_key, 0
    ));
  end if;

  if is_whatsapp_erasure_identifier_suppressed('event', v_event_key)
    or is_whatsapp_erasure_identifier_suppressed('outbound', v_outbound_key)
    or (
      coalesce(v_phone_hash, '') ~ '^[0-9a-f]{64}$'
      and exists (
        select 1 from whatsapp_erasure_tombstones t
        where t.kind = 'phone' and t.lookup_hash = v_phone_hash and t.expires_at > now()
          and t.erased_at > now() - interval '15 minutes'
      )
    )
    or (
      nullif(v_outbound_key, '') is not null
      and exists (
        select 1
        from whatsapp_outbound_ledger ledger
        join whatsapp_erasure_tombstones t
          on t.kind = 'phone' and t.lookup_hash = ledger.destination_hash and t.expires_at > now()
            and t.erased_at > now() - interval '15 minutes'
        where ledger.dedupe_key = v_outbound_key
      )
    ) then
    raise exception 'whatsapp_erasure_suppressed';
  end if;
  return new;
end;
$$;

drop trigger if exists block_erased_whatsapp_message_evidence on messages;
create trigger block_erased_whatsapp_message_evidence
  before insert or update of wa_message_id, outbound_ledger_key on messages
  for each row execute function block_erased_whatsapp_evidence_write();
drop trigger if exists block_erased_whatsapp_cost_evidence on whatsapp_cost_events;
create trigger block_erased_whatsapp_cost_evidence
  before insert or update of wa_id, wa_message_id, outbound_ledger_key on whatsapp_cost_events
  for each row execute function block_erased_whatsapp_evidence_write();
drop trigger if exists block_erased_whatsapp_consent_evidence on consent_records;
create trigger block_erased_whatsapp_consent_evidence
  before insert or update of evidence_message_id on consent_records
  for each row execute function block_erased_whatsapp_evidence_write();
drop trigger if exists block_erased_whatsapp_handoff_evidence on handoff_events;
create trigger block_erased_whatsapp_handoff_evidence
  before insert or update of source_wa_message_id on handoff_events
  for each row execute function block_erased_whatsapp_evidence_write();
drop trigger if exists block_erased_whatsapp_status_evidence on whatsapp_message_status_events;
create trigger block_erased_whatsapp_status_evidence
  before insert or update of wa_message_id on whatsapp_message_status_events
  for each row execute function block_erased_whatsapp_evidence_write();

-- Pseudonymous operational rows also participate in the phone-partition lock. They contain no raw
-- contact, but an uncommitted insert must not survive a completed erasure transaction.
create or replace function block_erased_whatsapp_hash_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone_hash text;
begin
  v_phone_hash := case tg_table_name
    when 'whatsapp_policy_evaluations' then to_jsonb(new)->>'conversation_hash'
    else to_jsonb(new)->>'phone_hash'
  end;
  if coalesce(v_phone_hash, '') ~ '^[0-9a-f]{64}$' then
    perform pg_advisory_xact_lock(hashtextextended(
      'whatsapp-erasure:' || v_phone_hash, 0
    ));
    if exists (
      select 1 from whatsapp_erasure_tombstones t
      where t.kind = 'phone' and t.lookup_hash = v_phone_hash and t.expires_at > now()
        and t.erased_at > now() - interval '15 minutes'
    ) then
      raise exception 'whatsapp_erasure_suppressed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists block_erased_whatsapp_lease_hash on whatsapp_conversation_leases;
create trigger block_erased_whatsapp_lease_hash
  before insert or update of phone_hash on whatsapp_conversation_leases
  for each row execute function block_erased_whatsapp_hash_write();

-- whatsapp_policy_evaluations is created by the later policy-shadow migration. Its trigger is
-- installed there, after the table exists, while reusing this function.

-- Include the short phone suppression in the final bot-ownership CAS.
create or replace function authorize_whatsapp_bot_dispatch(
  p_phone text,
  p_expected_state_version bigint
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not is_whatsapp_erasure_suppressed(p_phone, null) and coalesce((
    select not s.bot_paused
      and s.state not in ('handoff_pending', 'human_active', 'closed')
      and s.state_version = p_expected_state_version
    from whatsapp_sessions s where s.phone = p_phone
  ), false);
$$;

-- A concurrent erase can happen between the application pre-check and the outbound ledger claim.
-- Return an explicit suppression outcome before inserting any new technical row.
create or replace function claim_whatsapp_outbound_intent(
  p_dedupe_key text,
  p_source_event_hash text,
  p_destination_hash text,
  p_flow_step text,
  p_message_type text,
  p_payload_hash text,
  p_worker_id text
)
returns table (outcome text, wa_message_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row whatsapp_outbound_ledger%rowtype;
begin
  if coalesce(p_dedupe_key, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_source_event_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_destination_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_flow_step, '')) not between 1 and 120
    or length(coalesce(p_message_type, '')) not between 1 and 80
    or length(coalesce(p_worker_id, '')) not between 1 and 200 then
    raise exception 'invalid_outbound_intent';
  end if;

  -- Serialize ledger creation with erasure for this destination, then honor both the short
  -- contact window and the 90-day stable intent tombstone.
  perform pg_advisory_xact_lock(hashtextextended(
    'whatsapp-erasure:' || p_destination_hash, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'whatsapp-erasure-id:outbound:' || p_dedupe_key, 0
  ));
  if is_whatsapp_erasure_identifier_suppressed('outbound', p_dedupe_key)
    or exists (
    select 1 from whatsapp_erasure_tombstones t
    where t.kind = 'phone' and t.lookup_hash = p_destination_hash and t.expires_at > now()
      and t.erased_at > now() - interval '15 minutes'
  ) then
    return query select 'suppressed'::text, null::text;
    return;
  end if;

  insert into whatsapp_outbound_ledger(
    dedupe_key, source_event_hash, destination_hash, flow_step,
    message_type, payload_hash, status, worker_id
  ) values (
    p_dedupe_key, p_source_event_hash, p_destination_hash, p_flow_step,
    p_message_type, p_payload_hash, 'dispatching', p_worker_id
  ) on conflict (dedupe_key) do nothing
  returning * into v_row;

  if found then
    return query select 'dispatch'::text, null::text;
    return;
  end if;

  select * into v_row from whatsapp_outbound_ledger where dedupe_key = p_dedupe_key for update;
  if not found then raise exception 'outbound_intent_missing'; end if;

  if v_row.source_event_hash <> p_source_event_hash
    or v_row.destination_hash <> p_destination_hash
    or v_row.flow_step <> p_flow_step
    or v_row.message_type <> p_message_type
    or v_row.payload_hash <> p_payload_hash then
    update whatsapp_outbound_ledger
    set status = 'ambiguous', error_code = 'ledger_identity_conflict',
        ambiguous_at = coalesce(ambiguous_at, now()), updated_at = now()
    where dedupe_key = p_dedupe_key;
    return query select 'ambiguous'::text, v_row.wa_message_id;
    return;
  end if;

  if v_row.status = 'accepted' then
    return query select 'accepted'::text, v_row.wa_message_id;
  elsif v_row.status = 'ambiguous' then
    return query select 'ambiguous'::text, v_row.wa_message_id;
  elsif v_row.status = 'rejected' then
    return query select 'rejected'::text, null::text;
  elsif v_row.dispatch_started_at < now() - interval '10 minutes' then
    update whatsapp_outbound_ledger
    set status = 'ambiguous', error_code = coalesce(error_code, 'dispatch_lease_expired'),
        ambiguous_at = coalesce(ambiguous_at, now()), updated_at = now()
    where dedupe_key = p_dedupe_key;
    return query select 'ambiguous'::text, v_row.wa_message_id;
  else
    return query select 'in_flight'::text, null::text;
  end if;
end;
$$;

revoke all on function whatsapp_erasure_identifier_hmac(text, text)
  from public, anon, authenticated;
revoke all on function is_whatsapp_erasure_identifier_suppressed(text, text)
  from public, anon, authenticated;
revoke all on function create_whatsapp_erasure_tombstone(text, text)
  from public, anon, authenticated;
revoke all on function is_whatsapp_erasure_suppressed(text, text)
  from public, anon, authenticated;
revoke all on function is_whatsapp_erasure_event_suppressed(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function suppress_erased_whatsapp_queue_insert()
  from public, anon, authenticated;
revoke all on function complete_erased_whatsapp_webhook_event(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function block_erased_whatsapp_contact_write()
  from public, anon, authenticated;
revoke all on function block_erased_whatsapp_evidence_write()
  from public, anon, authenticated;
revoke all on function block_erased_whatsapp_hash_write()
  from public, anon, authenticated;
revoke all on function ensure_whatsapp_lead(text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function authorize_whatsapp_bot_dispatch(text, bigint)
  from public, anon, authenticated;
revoke all on function claim_whatsapp_outbound_intent(text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function is_whatsapp_erasure_suppressed(text, text) to service_role;
grant execute on function is_whatsapp_erasure_event_suppressed(text, text, timestamptz) to service_role;
grant execute on function complete_erased_whatsapp_webhook_event(uuid, text, text, text) to service_role;
grant execute on function ensure_whatsapp_lead(text, text, text, boolean, boolean, text) to service_role;
grant execute on function authorize_whatsapp_bot_dispatch(text, bigint) to service_role;
grant execute on function claim_whatsapp_outbound_intent(text, text, text, text, text, text, text)
  to service_role;
