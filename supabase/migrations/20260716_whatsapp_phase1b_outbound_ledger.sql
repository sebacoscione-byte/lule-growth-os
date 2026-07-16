-- Phase 1B: privacy-safe outbound intent ledger.
-- Provides at-most-once automatic dispatch attempts for a stable inbound-event + flow-step key.
-- It deliberately freezes uncertain network outcomes instead of blindly resending them.

create table if not exists whatsapp_outbound_ledger (
  dedupe_key text primary key check (dedupe_key ~ '^[0-9a-f]{64}$'),
  source_event_hash text not null check (source_event_hash ~ '^[0-9a-f]{64}$'),
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  flow_step text not null check (length(flow_step) between 1 and 120),
  message_type text not null check (length(message_type) between 1 and 80),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'dispatching'
    check (status in ('dispatching', 'accepted', 'ambiguous', 'rejected')),
  worker_id text not null,
  wa_message_id text,
  error_code text,
  dispatch_started_at timestamptz not null default now(),
  accepted_at timestamptz,
  ambiguous_at timestamptz,
  rejected_at timestamptz,
  accounted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_outbound_ledger_status_idx
  on whatsapp_outbound_ledger(status, dispatch_started_at);
create index if not exists whatsapp_outbound_ledger_wa_message_id_idx
  on whatsapp_outbound_ledger(wa_message_id) where wa_message_id is not null;

alter table whatsapp_outbound_ledger enable row level security;
drop policy if exists "service_role_all_whatsapp_outbound_ledger" on whatsapp_outbound_ledger;
create policy "service_role_all_whatsapp_outbound_ledger"
  on whatsapp_outbound_ledger for all to service_role using (true) with check (true);

alter table messages add column if not exists outbound_ledger_key text;
alter table whatsapp_cost_events add column if not exists outbound_ledger_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_outbound_ledger_key_unique') then
    alter table messages add constraint messages_outbound_ledger_key_unique unique (outbound_ledger_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_cost_events_outbound_ledger_key_unique') then
    alter table whatsapp_cost_events add constraint whatsapp_cost_events_outbound_ledger_key_unique unique (outbound_ledger_key);
  end if;
end $$;

alter table handoff_events drop constraint if exists handoff_events_reason_check;
alter table handoff_events add constraint handoff_events_reason_check check (
  reason in (
    'urgencia_medica', 'solicitud_explicita', 'conversacion_larga',
    'intent_no_entendido', 'sin_template_valido', 'entrega_ambigua'
  )
);

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

  insert into whatsapp_outbound_ledger (
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

  select * into v_row from whatsapp_outbound_ledger
  where dedupe_key = p_dedupe_key
  for update;

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

create or replace function finalize_whatsapp_outbound_intent(
  p_dedupe_key text,
  p_worker_id text,
  p_outcome text,
  p_wa_message_id text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('accepted', 'ambiguous', 'rejected') then
    raise exception 'invalid_outbound_outcome';
  end if;
  if p_outcome = 'accepted' and (p_wa_message_id is null or length(p_wa_message_id) > 512) then
    raise exception 'missing_wa_message_id';
  end if;

  update whatsapp_outbound_ledger
  set status = p_outcome,
      wa_message_id = case when p_wa_message_id is not null then p_wa_message_id else wa_message_id end,
      error_code = left(p_error_code, 80),
      accepted_at = case when p_outcome = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      ambiguous_at = case when p_outcome = 'ambiguous' then coalesce(ambiguous_at, now()) else ambiguous_at end,
      rejected_at = case when p_outcome = 'rejected' then coalesce(rejected_at, now()) else rejected_at end,
      updated_at = now()
  where dedupe_key = p_dedupe_key and status = 'dispatching' and worker_id = p_worker_id;

  if found then return true; end if;
  return exists (
    select 1 from whatsapp_outbound_ledger
    where dedupe_key = p_dedupe_key
      and status = p_outcome
      and (p_outcome <> 'accepted' or wa_message_id = p_wa_message_id)
  );
end;
$$;

create or replace function account_whatsapp_outbound_delivery(p_dedupe_key text, p_phone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destination_hash text;
begin
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
  update whatsapp_outbound_ledger set accounted_at = now(), updated_at = now()
  where dedupe_key = p_dedupe_key;
  return true;
end;
$$;

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
begin
  if coalesce(p_phone, '') !~ '^[0-9]{6,20}$' or coalesce(p_dedupe_key, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ambiguous_delivery';
  end if;

  select lead_id, messages_sent_count into v_lead_id, v_messages
  from whatsapp_sessions where phone = p_phone for update;

  update whatsapp_sessions
  set handoff_previous_state = case
        when state in ('handoff_pending', 'human_active', 'closed') then coalesce(handoff_previous_state, 'nuevo')
        else state
      end,
      state = 'handoff_pending', bot_paused = true,
      handoff_started_at = coalesce(handoff_started_at, now()),
      state_version = state_version + 1, updated_at = now()
  where phone = p_phone;
  if not found then
    insert into whatsapp_sessions(phone, state, bot_paused, handoff_previous_state, handoff_started_at, state_version)
    values (p_phone, 'handoff_pending', true, 'nuevo', now(), 1);
  end if;

  -- Una ambigüedad puede ocurrir al responder la aceptación de consentimiento, antes de que exista
  -- ficha. Crear una ficha operativa mínima hace visible el caso sin conservar el mensaje crudo.
  if v_lead_id is null then
    insert into leads(phone, origin_channel, consent_to_contact, status, requires_human)
    values (p_phone, 'whatsapp', false, 'requiere_humano', true)
    returning id into v_lead_id;
    update whatsapp_sessions set lead_id = v_lead_id, updated_at = now() where phone = p_phone;
  end if;

  update leads set requires_human = true, updated_at = now() where id = v_lead_id;
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

create or replace function reconcile_whatsapp_outbound_acceptance(p_wa_message_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update whatsapp_outbound_ledger
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
  where wa_message_id = p_wa_message_id and status in ('dispatching', 'ambiguous');
$$;

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
    update whatsapp_outbound_ledger
    set status = 'ambiguous', error_code = coalesce(error_code, 'dispatch_lease_expired'),
        ambiguous_at = coalesce(ambiguous_at, now()), updated_at = now()
    where status = 'dispatching' and dispatch_started_at < now() - interval '10 minutes'
    returning dedupe_key, destination_hash
  loop
    v_count := v_count + 1;
    select phone into v_phone from whatsapp_sessions
    where encode(digest(phone, 'sha256'), 'hex') = v_row.destination_hash
    limit 1;
    if v_phone is not null then
      begin
        perform quarantine_whatsapp_ambiguous_delivery(v_phone, v_row.dedupe_key, 'dispatch_lease_expired');
      exception when others then
        -- Una fila defectuosa no debe impedir que la cola entrante procese otras conversaciones.
        null;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function claim_whatsapp_outbound_intent(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function finalize_whatsapp_outbound_intent(text, text, text, text, text) from public, anon, authenticated;
revoke all on function account_whatsapp_outbound_delivery(text, text) from public, anon, authenticated;
revoke all on function quarantine_whatsapp_ambiguous_delivery(text, text, text) from public, anon, authenticated;
revoke all on function reconcile_whatsapp_outbound_acceptance(text) from public, anon, authenticated;
revoke all on function recover_stale_whatsapp_outbound_intents() from public, anon, authenticated;
grant execute on function claim_whatsapp_outbound_intent(text, text, text, text, text, text, text) to service_role;
grant execute on function finalize_whatsapp_outbound_intent(text, text, text, text, text) to service_role;
grant execute on function account_whatsapp_outbound_delivery(text, text) to service_role;
grant execute on function quarantine_whatsapp_ambiguous_delivery(text, text, text) to service_role;
grant execute on function reconcile_whatsapp_outbound_acceptance(text) to service_role;
grant execute on function recover_stale_whatsapp_outbound_intents() to service_role;
