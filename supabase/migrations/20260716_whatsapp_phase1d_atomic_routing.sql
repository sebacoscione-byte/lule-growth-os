-- Phase 1D: atomic WhatsApp lead routing and fail-closed dispatch controls.
--
-- This migration does not enable the bot. It makes retries converge on one lead, prevents a
-- normal automatic response after a staff takeover observed by the dispatch boundary, and makes
-- a dead-lettered inbound event visible to staff without retaining the patient's message text.

create extension if not exists pgcrypto;

-- Meta message ids are global delivery identifiers. Preserve one canonical historical row and
-- quarantine any duplicate before enforcing that invariant for future reconciliation/accounting.
with duplicate_provider_ids as (
  select dedupe_key,
    row_number() over (
      partition by wa_message_id
      order by
        case status when 'accepted' then 0 when 'ambiguous' then 1 else 2 end,
        coalesce(accepted_at, ambiguous_at, rejected_at, created_at),
        dedupe_key
    ) as position
  from whatsapp_outbound_ledger
  where wa_message_id is not null
)
update whatsapp_outbound_ledger ledger
set wa_message_id = null,
    status = 'ambiguous',
    error_code = 'duplicate_provider_message_id',
    ambiguous_at = coalesce(ambiguous_at, now()),
    updated_at = now()
from duplicate_provider_ids duplicate
where ledger.dedupe_key = duplicate.dedupe_key and duplicate.position > 1;

create unique index if not exists whatsapp_outbound_ledger_wa_message_id_unique
  on whatsapp_outbound_ledger(wa_message_id)
  where wa_message_id is not null;

-- Keep the deterministic lookup out of `leads` so it is never returned by broad staff-facing
-- lead selects. Only service_role can read or mutate this technical identity map.
create table if not exists whatsapp_lead_identities (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid not null unique references leads(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table whatsapp_lead_identities enable row level security;
alter table whatsapp_lead_identities force row level security;
drop policy if exists "service_role_all_whatsapp_lead_identities" on whatsapp_lead_identities;
create policy "service_role_all_whatsapp_lead_identities"
  on whatsapp_lead_identities for all to service_role using (true) with check (true);
revoke all on table whatsapp_lead_identities from public, anon, authenticated;
grant select, insert, update, delete on table whatsapp_lead_identities to service_role;

-- Prefer the lead already linked to the conversation when historical duplicates exist. A single
-- canonical mapping is created; legacy duplicates remain untouched for explicit staff review.
with ranked as (
  select
    l.id,
    encode(digest(l.phone, 'sha256'), 'hex') as phone_hash,
    row_number() over (
      partition by l.phone
      order by
        case when exists (
          select 1 from whatsapp_sessions s where s.phone = l.phone and s.lead_id = l.id
        ) then 0 else 1 end,
        l.created_at,
        l.id
    ) as position
  from leads l
  where l.origin_channel = 'whatsapp' and l.phone ~ '^[0-9]{6,20}$'
)
insert into whatsapp_lead_identities(phone_hash, lead_id)
select phone_hash, id from ranked where position = 1
on conflict do nothing;

create or replace function ensure_whatsapp_lead_core(
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
declare
  v_phone_hash text;
  v_lead_id uuid;
  v_mapped_lead_id uuid;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' then
    raise exception 'invalid_phone';
  end if;
  if p_name is not null and length(p_name) > 200 then
    raise exception 'invalid_name';
  end if;
  if p_status not in ('interesado', 'requiere_humano', 'urgencia_derivada') then
    raise exception 'invalid_whatsapp_lead_status';
  end if;

  v_phone_hash := encode(digest(p_phone, 'sha256'), 'hex');

  insert into whatsapp_sessions(phone, state)
  values (p_phone, 'nuevo')
  on conflict (phone) do nothing;

  -- The session row is the per-phone serialization point, including the first ever event.
  select lead_id into v_lead_id
  from whatsapp_sessions
  where phone = p_phone
  for update;

  if v_lead_id is null then
    select lead_id into v_lead_id
    from whatsapp_lead_identities
    where phone_hash = v_phone_hash;

    if v_lead_id is null then
      insert into leads(
        phone, name, origin_channel, consent_to_contact, status,
        possible_emergency, requires_human
      ) values (
        p_phone, nullif(btrim(p_name), ''), 'whatsapp', false, p_status,
        coalesce(p_possible_emergency, false), coalesce(p_requires_human, false)
      )
      returning id into v_lead_id;

      insert into whatsapp_lead_identities(phone_hash, lead_id)
      values (v_phone_hash, v_lead_id);
    end if;

    update whatsapp_sessions
    set lead_id = v_lead_id, updated_at = now()
    where phone = p_phone;
  else
    perform 1 from leads
    where id = v_lead_id and phone = p_phone and origin_channel = 'whatsapp';
    if not found then raise exception 'whatsapp_session_lead_mismatch'; end if;

    select lead_id into v_mapped_lead_id
    from whatsapp_lead_identities
    where phone_hash = v_phone_hash
    for update;
    if v_mapped_lead_id is null then
      insert into whatsapp_lead_identities(phone_hash, lead_id)
      values (v_phone_hash, v_lead_id);
    elsif v_mapped_lead_id <> v_lead_id then
      -- The live, locked session is authoritative. Do not silently preserve a split identity.
      update whatsapp_lead_identities
      set lead_id = v_lead_id
      where phone_hash = v_phone_hash;
    end if;
  end if;

  update leads
  set name = coalesce(name, nullif(btrim(p_name), '')),
      possible_emergency = possible_emergency or coalesce(p_possible_emergency, false),
      requires_human = requires_human or coalesce(p_requires_human, false),
      status = case
        when p_status = 'urgencia_derivada' then 'urgencia_derivada'
        when coalesce(p_requires_human, false) and status in ('nuevo', 'interesado')
          then 'requiere_humano'
        when status = 'nuevo' then p_status
        else status
      end,
      updated_at = now()
  where id = v_lead_id;

  if not found then raise exception 'whatsapp_lead_not_found'; end if;
  return v_lead_id;
end;
$$;

create or replace function ensure_whatsapp_lead(
  p_phone text,
  p_name text default null,
  p_status text default 'interesado',
  p_possible_emergency boolean default false,
  p_requires_human boolean default false,
  p_source_wa_message_id text default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select ensure_whatsapp_lead_core(
    p_phone, p_name, p_status, p_possible_emergency, p_requires_human, p_source_wa_message_id
  );
$$;

-- The first administrative intake, recovered inbox message, cost link, consent link and session
-- link commit together. A retry with the same Meta message id becomes a no-op for the message.
create or replace function upsert_whatsapp_intake_lead(
  p_phone text,
  p_name text,
  p_requested_service text,
  p_general_reason text,
  p_insurance text,
  p_utm_content text,
  p_landing_page text,
  p_raw_message text,
  p_wa_message_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' then raise exception 'invalid_phone'; end if;
  if p_requested_service is not null
    and p_requested_service not in ('consulta_cardiologia', 'ecocardiograma', 'no_definido') then
    raise exception 'invalid_requested_service';
  end if;
  if p_general_reason is not null
    and p_general_reason not in ('consulta_cardiologica', 'estudio_cardiologico', 'protocolo_investigacion') then
    raise exception 'invalid_general_reason';
  end if;
  if length(coalesce(p_insurance, '')) > 200
    or length(coalesce(p_utm_content, '')) > 200
    or length(coalesce(p_landing_page, '')) > 200
    or length(coalesce(p_raw_message, '')) > 4096
    or length(coalesce(p_wa_message_id, '')) > 512 then
    raise exception 'invalid_intake_payload';
  end if;

  -- Defense in depth: TypeScript checks this too, but the transactional writer itself must fail
  -- closed if there is no current, explicit administrative consent.
  if not coalesce((
    select c.consented and c.version = 'v2-administrative-service'
    from consent_records c
    where c.wa_id = p_phone and c.purpose = 'administrative_service'
    order by c.created_at desc, c.id desc
    limit 1
  ), false) then
    raise exception 'administrative_consent_required';
  end if;

  v_lead_id := ensure_whatsapp_lead(
    p_phone, p_name, 'interesado', false, false, p_wa_message_id
  );

  update leads
  set requested_service = coalesce(p_requested_service, requested_service),
      general_reason = coalesce(p_general_reason, general_reason),
      insurance = coalesce(nullif(btrim(p_insurance), ''), insurance),
      utm_content = coalesce(nullif(btrim(p_utm_content), ''), utm_content),
      landing_page = coalesce(nullif(btrim(p_landing_page), ''), landing_page),
      updated_at = now()
  where id = v_lead_id;

  if nullif(btrim(p_raw_message), '') is not null and nullif(p_wa_message_id, '') is not null then
    insert into messages(lead_id, role, content, direction, wa_message_id)
    values (v_lead_id, 'user', btrim(p_raw_message), 'inbound', p_wa_message_id)
    on conflict (wa_message_id) do nothing;
  end if;

  if nullif(p_wa_message_id, '') is not null then
    update whatsapp_cost_events
    set lead_id = v_lead_id
    where wa_message_id = p_wa_message_id and lead_id is null;
  end if;

  update consent_records
  set lead_id = v_lead_id
  where wa_id = p_phone and lead_id is null;

  return v_lead_id;
end;
$$;

-- A dispatch is authorized only if staff has not changed the bot ownership/version since this
-- inbound handler loaded the session. The caller rechecks immediately before the Meta request.
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
  select coalesce((
    select not s.bot_paused
      and s.state not in ('handoff_pending', 'human_active', 'closed')
      and s.state_version = p_expected_state_version
    from whatsapp_sessions s
    where s.phone = p_phone
  ), false);
$$;

-- Replace the Phase 0B writer so a handoff can never remain detached from erasure/retention.
-- Direct identifiers are removed from the duplicated JSON summary; the linked lead remains the
-- sole operational source for name/phone.
create or replace function create_whatsapp_handoff(
  p_phone text,
  p_lead_id uuid,
  p_reason text,
  p_summary jsonb,
  p_messages_sent_count integer,
  p_cost_estimated_total numeric,
  p_source_wa_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
  v_lead_id uuid;
  v_session_lead_id uuid;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' then raise exception 'invalid_phone'; end if;
  if p_reason not in (
    'urgencia_medica', 'solicitud_explicita', 'conversacion_larga',
    'intent_no_entendido', 'sin_template_valido', 'entrega_ambigua'
  ) then raise exception 'invalid_handoff_reason'; end if;
  if p_source_wa_message_id is not null and length(p_source_wa_message_id) > 512 then
    raise exception 'invalid_source_wa_message_id';
  end if;

  if p_lead_id is null then
    v_lead_id := ensure_whatsapp_lead(
      p_phone,
      null,
      case when p_reason = 'urgencia_medica' then 'urgencia_derivada' else 'requiere_humano' end,
      p_reason = 'urgencia_medica',
      true,
      p_source_wa_message_id
    );
  else
    select id into v_lead_id from leads where id = p_lead_id and phone = p_phone;
    if v_lead_id is null then raise exception 'whatsapp_handoff_lead_mismatch'; end if;

    insert into whatsapp_sessions(phone, state, lead_id)
    values (p_phone, 'nuevo', v_lead_id)
    on conflict (phone) do nothing;
    select lead_id into v_session_lead_id
    from whatsapp_sessions where phone = p_phone for update;
    if v_session_lead_id is not null and v_session_lead_id <> v_lead_id then
      raise exception 'whatsapp_handoff_session_mismatch';
    end if;
    update whatsapp_sessions set lead_id = v_lead_id, updated_at = now() where phone = p_phone;
    insert into whatsapp_lead_identities(phone_hash, lead_id)
    values (encode(digest(p_phone, 'sha256'), 'hex'), v_lead_id)
    on conflict (phone_hash) do update set lead_id = excluded.lead_id;
  end if;

  update whatsapp_sessions
  set handoff_previous_state = case
        when state in ('handoff_pending', 'human_active', 'closed')
          then coalesce(handoff_previous_state, 'nuevo')
        else state
      end,
      state = 'handoff_pending', bot_paused = true,
      handoff_started_at = coalesce(handoff_started_at, now()),
      state_version = state_version + 1, updated_at = now()
  where phone = p_phone;

  insert into handoff_events(
    lead_id, reason, summary, messages_sent_count, cost_estimated_total, source_wa_message_id
  ) values (
    v_lead_id,
    p_reason,
    coalesce(p_summary, '{}'::jsonb) - 'telefono' - 'nombre' - 'ultimo_mensaje',
    greatest(coalesce(p_messages_sent_count, 0), 0),
    p_cost_estimated_total,
    p_source_wa_message_id
  ) on conflict do nothing;
  v_inserted := found;

  update leads
  set requires_human = true,
      possible_emergency = possible_emergency or p_reason = 'urgencia_medica',
      status = case when p_reason = 'urgencia_medica' then 'urgencia_derivada' else status end,
      updated_at = now()
  where id = v_lead_id;

  return v_inserted;
end;
$$;

-- Before the queue scrubs PII from a dead letter, create a minimal operational case. The raw
-- message/name are intentionally not copied to either the lead or handoff summary.
create or replace function preserve_whatsapp_dead_letter_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  if new.status = 'dead_letter'
    and old.status <> 'dead_letter'
    and old.event_type = 'inbound'
    and old.phone ~ '^[0-9]{6,20}$' then
    v_lead_id := ensure_whatsapp_lead(
      old.phone, null, 'requiere_humano', false, true, old.related_wa_message_id
    );
    perform create_whatsapp_handoff(
      old.phone,
      v_lead_id,
      'entrega_ambigua',
      jsonb_build_object('technical_code', 'inbound_event_dead_letter'),
      coalesce((select messages_sent_count from whatsapp_sessions where phone = old.phone), 0),
      null,
      old.related_wa_message_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_dead_letter_handoff on whatsapp_webhook_events;
create trigger whatsapp_dead_letter_handoff
  before update of status on whatsapp_webhook_events
  for each row execute function preserve_whatsapp_dead_letter_handoff();

-- Validate the destination before accounting an accepted outbound message. Never mark it
-- accounted unless the matching session counter was actually incremented.
create or replace function account_whatsapp_outbound_delivery(p_dedupe_key text, p_phone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destination_hash text;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' then raise exception 'invalid_phone'; end if;

  select destination_hash into v_destination_hash
  from whatsapp_outbound_ledger
  where dedupe_key = p_dedupe_key and status = 'accepted' and accounted_at is null
  for update;
  if not found then return false; end if;
  if encode(digest(p_phone, 'sha256'), 'hex') <> v_destination_hash then
    raise exception 'outbound_destination_mismatch';
  end if;

  update whatsapp_sessions
  set messages_sent_count = messages_sent_count + 1, updated_at = now()
  where phone = p_phone;
  if not found then raise exception 'whatsapp_session_not_found'; end if;

  update whatsapp_outbound_ledger set accounted_at = now(), updated_at = now()
  where dedupe_key = p_dedupe_key and accounted_at is null;
  return found;
end;
$$;

-- The ledger row is locked and validated before pausing a conversation. Dispatching rows are
-- explicitly frozen as ambiguous first; accepted/rejected or mismatched rows cannot be spoofed.
create or replace function quarantine_whatsapp_ambiguous_delivery(
  p_phone text,
  p_dedupe_key text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
  v_messages integer := 0;
  v_destination_hash text;
  v_status text;
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$'
    or coalesce(p_dedupe_key, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ambiguous_delivery';
  end if;

  select destination_hash, status into v_destination_hash, v_status
  from whatsapp_outbound_ledger where dedupe_key = p_dedupe_key for update;
  if not found then raise exception 'outbound_ledger_not_found'; end if;
  if v_destination_hash <> encode(digest(p_phone, 'sha256'), 'hex') then
    raise exception 'outbound_destination_mismatch';
  end if;
  if v_status = 'dispatching' then
    update whatsapp_outbound_ledger
    set status = 'ambiguous', ambiguous_at = coalesce(ambiguous_at, now()),
        error_code = left(coalesce(p_error_code, 'delivery_ambiguous'), 80), updated_at = now()
    where dedupe_key = p_dedupe_key;
  elsif v_status <> 'ambiguous' then
    raise exception 'outbound_not_ambiguous';
  end if;

  v_lead_id := ensure_whatsapp_lead(p_phone, null, 'requiere_humano', false, true);
  select messages_sent_count into v_messages
  from whatsapp_sessions where phone = p_phone;

  update whatsapp_sessions
  set handoff_previous_state = case
        when state in ('handoff_pending', 'human_active', 'closed') then coalesce(handoff_previous_state, 'nuevo')
        else state
      end,
      state = 'handoff_pending', bot_paused = true,
      handoff_started_at = coalesce(handoff_started_at, now()),
      state_version = state_version + 1, updated_at = now()
  where phone = p_phone;

  insert into handoff_events(lead_id, reason, summary, messages_sent_count)
  select v_lead_id, 'entrega_ambigua', jsonb_build_object(
    'technical_code', 'outbound_delivery_ambiguous',
    'ledger_key', p_dedupe_key,
    'error_code', left(coalesce(p_error_code, 'delivery_ambiguous'), 80)
  ), greatest(coalesce(v_messages, 0), 0)
  where not exists (
    select 1 from handoff_events
    where lead_id = v_lead_id and resolved_at is null and reason = 'entrega_ambigua'
      and summary->>'ledger_key' = p_dedupe_key
  );
  return true;
end;
$$;

-- A failed quarantine no longer leaves the row silently frozen: its subtransaction rolls back and
-- the row remains dispatching so the next worker can try the recovery again.
create or replace function recover_stale_whatsapp_outbound_intents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_phone text;
  v_count integer := 0;
begin
  for v_row in
    select dedupe_key, destination_hash, flow_step
    from whatsapp_outbound_ledger
    where status = 'dispatching' and dispatch_started_at < now() - interval '10 minutes'
    order by dispatch_started_at
    for update skip locked
  loop
    select candidate.phone into v_phone
    from (
      select s.phone, 1 as priority
      from whatsapp_sessions s
      where encode(digest(s.phone, 'sha256'), 'hex') = v_row.destination_hash
      union all
      select l.phone, 2 as priority
      from whatsapp_lead_identities i
      join leads l on l.id = i.lead_id
      where i.phone_hash = v_row.destination_hash and l.phone is not null
      union all
      select l.phone, 3 as priority
      from leads l
      where l.origin_channel = 'whatsapp'
        and l.phone is not null
        and encode(digest(l.phone, 'sha256'), 'hex') = v_row.destination_hash
    ) candidate
    order by candidate.priority
    limit 1;

    if v_row.flow_step = 'internal_handoff_alert' then
      -- This explicit internal flow must never pause a patient conversation, even if its alert
      -- number happens to match historical test/contact data.
      update whatsapp_outbound_ledger
      set status = 'ambiguous', error_code = coalesce(error_code, 'unmapped_dispatch_lease_expired'),
          ambiguous_at = coalesce(ambiguous_at, now()), updated_at = now()
      where dedupe_key = v_row.dedupe_key and status = 'dispatching';
      if found then v_count := v_count + 1; end if;
    elsif v_phone is not null then
      begin
        perform quarantine_whatsapp_ambiguous_delivery(
          v_phone, v_row.dedupe_key, 'dispatch_lease_expired'
        );
        v_count := v_count + 1;
      exception when others then
        -- PostgreSQL rolls this subtransaction back, including any partial status change. Keeping
        -- `dispatching` is deliberate: the next worker retries instead of hiding the incident.
        null;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Repair legacy orphan handoffs when their old summary still carries a valid phone. Remaining
-- records are retained for audit but direct identifiers are scrubbed; no open/urgent event is
-- deleted silently during deployment.
do $$
declare
  v_handoff record;
  v_lead_id uuid;
begin
  for v_handoff in
    select id, reason, summary, resolved_at
    from handoff_events
    where lead_id is null
    for update
  loop
    begin
      if v_handoff.resolved_at is null
        and coalesce(v_handoff.summary->>'telefono', '') ~ '^[0-9]{6,20}$' then
        v_lead_id := ensure_whatsapp_lead(
          v_handoff.summary->>'telefono',
          nullif(v_handoff.summary->>'nombre', ''),
          case when v_handoff.reason = 'urgencia_medica' then 'urgencia_derivada' else 'requiere_humano' end,
          v_handoff.reason = 'urgencia_medica',
          true
        );
        update handoff_events
        set lead_id = v_lead_id,
            summary = summary - 'telefono' - 'nombre' - 'ultimo_mensaje'
        where id = v_handoff.id;
        update whatsapp_sessions
        set handoff_previous_state = case
              when state in ('handoff_pending', 'human_active', 'closed')
                then coalesce(handoff_previous_state, 'nuevo')
              else state
            end,
            state = 'handoff_pending', bot_paused = true,
            handoff_started_at = coalesce(handoff_started_at, now()),
            state_version = state_version + 1, updated_at = now()
        where phone = v_handoff.summary->>'telefono';
      elsif v_handoff.resolved_at is null then
        -- Keep an unrecoverable open legacy incident visible without retaining its old direct
        -- identifiers. It is intentionally not connected to any automatic conversation.
        insert into leads(origin_channel, consent_to_contact, status, requires_human)
        values ('whatsapp', false, 'requiere_humano', true)
        returning id into v_lead_id;
        update handoff_events
        set lead_id = v_lead_id,
            summary = (summary - 'telefono' - 'nombre' - 'ultimo_mensaje')
              || jsonb_build_object('technical_code', 'legacy_orphan_unrecoverable')
        where id = v_handoff.id;
      else
        update handoff_events
        set summary = summary - 'telefono' - 'nombre' - 'ultimo_mensaje'
        where id = v_handoff.id;
      end if;
    exception when others then
      if v_handoff.resolved_at is null then
        insert into leads(origin_channel, consent_to_contact, status, requires_human)
        values ('whatsapp', false, 'requiere_humano', true)
        returning id into v_lead_id;
        update handoff_events
        set lead_id = v_lead_id,
            summary = (summary - 'telefono' - 'nombre' - 'ultimo_mensaje')
              || jsonb_build_object('technical_code', 'legacy_orphan_repair_failed')
        where id = v_handoff.id;
      else
        update handoff_events
        set summary = summary - 'telefono' - 'nombre' - 'ultimo_mensaje'
        where id = v_handoff.id;
      end if;
    end;
  end loop;
end $$;

-- Legacy open incidents without a recoverable phone can still be taken and closed from Inbox.
-- Reactivation remains impossible because there is no automatic conversation to reactivate.
create or replace function transition_whatsapp_handoff(
  p_lead_id uuid,
  p_action text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  if p_action not in ('take', 'reactivate', 'close') then raise exception 'invalid_handoff_action'; end if;
  select phone into v_phone from leads where id = p_lead_id;
  if not found then raise exception 'whatsapp_lead_not_found'; end if;

  if v_phone is null then
    if p_action = 'reactivate' then raise exception 'whatsapp_session_not_found'; end if;
    if p_action = 'take' then
      update handoff_events
      set taken_at = coalesce(taken_at, now()), taken_by = coalesce(taken_by, p_actor)
      where lead_id = p_lead_id and resolved_at is null;
      update leads set requires_human = true, updated_at = now() where id = p_lead_id;
    else
      update handoff_events
      set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, p_actor)
      where lead_id = p_lead_id and resolved_at is null;
      update leads set requires_human = false, updated_at = now() where id = p_lead_id;
    end if;
    return;
  end if;

  if p_action = 'take' then
    update handoff_events
    set taken_at = coalesce(taken_at, now()), taken_by = coalesce(taken_by, p_actor)
    where lead_id = p_lead_id and resolved_at is null;
    update whatsapp_sessions
    set handoff_previous_state = case
          when state in ('handoff_pending', 'human_active', 'closed')
            then coalesce(handoff_previous_state, 'nuevo')
          else state
        end,
        handoff_started_at = coalesce(handoff_started_at, now()),
        state = 'human_active', bot_paused = true,
        state_version = state_version + 1, updated_at = now()
    where phone = v_phone;
    update leads set requires_human = true, updated_at = now() where id = p_lead_id;
  else
    update handoff_events
    set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, p_actor)
    where lead_id = p_lead_id and resolved_at is null;
    update leads set requires_human = false, updated_at = now() where id = p_lead_id;

    if p_action = 'reactivate' then
      update whatsapp_sessions
      set state = case
            when handoff_previous_state in (
              'nuevo', 'esperando_consentimiento', 'intake_pendiente',
              'esperando_obra_social', 'esperando_sede', 'esperando_seguimiento', 'derivado'
            ) then handoff_previous_state else 'nuevo' end,
          bot_paused = false, handoff_previous_state = null, handoff_started_at = null,
          state_version = state_version + 1, updated_at = now()
      where phone = v_phone;
    else
      update whatsapp_sessions
      set state = 'closed', bot_paused = true,
          handoff_previous_state = null, handoff_started_at = null,
          state_version = state_version + 1, updated_at = now()
      where phone = v_phone;
    end if;
  end if;
end;
$$;

-- Reserve DLQ alert rows before contacting the email provider, but acknowledge them only after a
-- confirmed 2xx response. Failed/missing email configuration releases the lease for a later try.
alter table whatsapp_webhook_events
  add column if not exists alert_claim_token uuid,
  add column if not exists alert_claimed_at timestamptz;

drop function if exists claim_whatsapp_dead_letter_alerts();
create function claim_whatsapp_dead_letter_alerts()
returns table (claim_token uuid, event_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_count integer;
begin
  update whatsapp_webhook_events
  set alert_claim_token = v_token, alert_claimed_at = now()
  where status = 'dead_letter'
    and alerted_at is null
    and (alert_claimed_at is null or alert_claimed_at < now() - interval '15 minutes');
  get diagnostics v_count = row_count;
  return query select v_token, v_count;
end;
$$;

create or replace function finalize_whatsapp_dead_letter_alert(
  p_claim_token uuid,
  p_delivered boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_claim_token is null then raise exception 'invalid_alert_claim'; end if;
  update whatsapp_webhook_events
  set alerted_at = case when coalesce(p_delivered, false) then now() else alerted_at end,
      alert_claim_token = null,
      alert_claimed_at = null
  where status = 'dead_letter'
    and alerted_at is null
    and alert_claim_token = p_claim_token;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function ensure_whatsapp_lead(text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function ensure_whatsapp_lead_core(text, text, text, boolean, boolean, text)
  from public, anon, authenticated;
revoke all on function upsert_whatsapp_intake_lead(text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function authorize_whatsapp_bot_dispatch(text, bigint)
  from public, anon, authenticated;
revoke all on function create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text)
  from public, anon, authenticated;
revoke all on function transition_whatsapp_handoff(uuid, text, text)
  from public, anon, authenticated;
revoke all on function account_whatsapp_outbound_delivery(text, text)
  from public, anon, authenticated;
revoke all on function quarantine_whatsapp_ambiguous_delivery(text, text, text)
  from public, anon, authenticated;
revoke all on function recover_stale_whatsapp_outbound_intents()
  from public, anon, authenticated;
revoke all on function preserve_whatsapp_dead_letter_handoff()
  from public, anon, authenticated;
revoke all on function claim_whatsapp_dead_letter_alerts()
  from public, anon, authenticated;
revoke all on function finalize_whatsapp_dead_letter_alert(uuid, boolean)
  from public, anon, authenticated;

grant execute on function ensure_whatsapp_lead(text, text, text, boolean, boolean, text) to service_role;
grant execute on function upsert_whatsapp_intake_lead(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function authorize_whatsapp_bot_dispatch(text, bigint) to service_role;
grant execute on function create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text) to service_role;
grant execute on function transition_whatsapp_handoff(uuid, text, text) to service_role;
grant execute on function account_whatsapp_outbound_delivery(text, text) to service_role;
grant execute on function quarantine_whatsapp_ambiguous_delivery(text, text, text) to service_role;
grant execute on function recover_stale_whatsapp_outbound_intents() to service_role;
grant execute on function claim_whatsapp_dead_letter_alerts() to service_role;
grant execute on function finalize_whatsapp_dead_letter_alert(uuid, boolean) to service_role;
