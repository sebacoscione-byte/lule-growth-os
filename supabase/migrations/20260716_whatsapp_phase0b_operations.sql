-- ============================================================
-- Fase 0B: handoff durable, estados operativos y control humano
--
-- Debe aplicarse antes que el código que invoca estas funciones.
-- No contiene secretos ni activa automatizaciones por sí sola.
-- ============================================================

alter table whatsapp_sessions
  add column if not exists handoff_previous_state text,
  add column if not exists handoff_started_at timestamptz,
  add column if not exists state_version bigint not null default 0;

alter table leads
  add column if not exists whatsapp_followup_sent_at timestamptz,
  add column if not exists whatsapp_followup_claimed_at timestamptz,
  add column if not exists whatsapp_followup_status text not null default 'not_requested';

alter table leads drop constraint if exists leads_whatsapp_followup_status_check;
alter table leads add constraint leads_whatsapp_followup_status_check check (
  whatsapp_followup_status in ('not_requested', 'pending', 'dispatching', 'sent', 'declined', 'cancelled', 'ambiguous')
);

update leads
set whatsapp_followup_status = 'pending'
where followup_due_at is not null
  and consent_to_contact = true
  and whatsapp_followup_sent_at is null
  and whatsapp_followup_status = 'not_requested';

do $$
declare
  existing_constraint text;
begin
  select con.conname into existing_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'whatsapp_sessions'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%state%'
  limit 1;

  if existing_constraint is not null then
    execute format('alter table whatsapp_sessions drop constraint %I', existing_constraint);
  end if;
end $$;

alter table whatsapp_sessions
  add constraint whatsapp_sessions_state_check check (state in (
    'nuevo', 'esperando_consentimiento', 'intake_pendiente',
    'esperando_obra_social', 'esperando_sede', 'esperando_seguimiento', 'derivado',
    'handoff_pending', 'human_active', 'closed'
  ));

alter table handoff_events
  add column if not exists taken_at timestamptz,
  add column if not exists taken_by text,
  add column if not exists source_wa_message_id text;

create unique index if not exists handoff_events_source_reason_unique
  on handoff_events(source_wa_message_id, reason)
  where source_wa_message_id is not null;

-- La versión anterior duplicaba todo el resumen de handoff dentro de leads.ai_summary.
update leads
set ai_summary = null
where ai_summary like '%"telefono"%'
  and ai_summary like '%"proximo_paso_recomendado"%';

drop policy if exists "authenticated_update_handoff_events" on handoff_events;

create index if not exists whatsapp_sessions_handoff_state_idx
  on whatsapp_sessions(state, handoff_started_at)
  where state in ('handoff_pending', 'human_active');

create index if not exists handoff_events_open_idx
  on handoff_events(created_at)
  where resolved_at is null;

create index if not exists leads_whatsapp_followup_due_idx
  on leads(followup_due_at)
  where whatsapp_followup_status = 'pending' and whatsapp_followup_sent_at is null;

-- Claim antes de llamar a Meta. Si la función muere después del envío, queda dispatching para
-- revisión humana y no se reenvía a ciegas una comunicación posiblemente aceptada por Meta.
create or replace function claim_whatsapp_followup(p_lead_id uuid, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update leads
  set whatsapp_followup_status = 'dispatching',
      whatsapp_followup_claimed_at = coalesce(p_now, now()),
      updated_at = now()
  where id = p_lead_id
    and origin_channel = 'whatsapp'
    and status in ('derivado_cimel', 'derivado_swiss', 'derivado_britanico', 'seguimiento_pendiente')
    and whatsapp_followup_status = 'pending'
    and whatsapp_followup_sent_at is null
    and followup_due_at <= coalesce(p_now, now())
    and consent_to_contact = true
    and requires_human = false
    and coalesce((
      select c.consented and c.version = 'v1-appointment-followup'
      from consent_records c
      where c.wa_id = leads.phone
        and c.purpose = 'appointment_followup'
      order by c.created_at desc, c.id desc
      limit 1
    ), false)
    and not exists (
      select 1
      from whatsapp_sessions s
      where s.phone = leads.phone
        and (s.bot_paused or s.state in ('handoff_pending', 'human_active', 'closed'))
    );
  return found;
end;
$$;

create or replace function complete_whatsapp_followup(p_lead_id uuid, p_outcome text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_completed boolean;
begin
  if p_outcome not in ('sent', 'ambiguous') then
    raise exception 'invalid_followup_outcome';
  end if;

  update leads
  set whatsapp_followup_status = p_outcome,
      whatsapp_followup_sent_at = case when p_outcome = 'sent' then coalesce(p_now, now()) else null end,
      followup_due_at = null,
      status = case when p_outcome = 'sent' then 'seguimiento_pendiente' else status end,
      updated_at = now()
  where id = p_lead_id and whatsapp_followup_status = 'dispatching';
  v_completed := found;

  if v_completed and p_outcome = 'ambiguous' then
    select phone into v_phone from leads where id = p_lead_id;
    update leads set requires_human = true, updated_at = now() where id = p_lead_id;
    update whatsapp_sessions
    set handoff_previous_state = case
          when state in ('handoff_pending', 'human_active', 'closed')
            then coalesce(handoff_previous_state, 'derivado')
          else state
        end,
        state = 'handoff_pending', bot_paused = true,
        handoff_started_at = coalesce(handoff_started_at, now()),
        state_version = state_version + 1, updated_at = now()
    where phone = v_phone;
    insert into handoff_events(lead_id, reason, summary, messages_sent_count)
    select p_lead_id, 'entrega_ambigua',
      jsonb_build_object('technical_code', 'followup_delivery_ambiguous'),
      coalesce((select messages_sent_count from whatsapp_sessions where phone = v_phone), 0)
    where not exists (
      select 1 from handoff_events
      where lead_id = p_lead_id and reason = 'entrega_ambigua' and resolved_at is null
        and summary->>'technical_code' = 'followup_delivery_ambiguous'
    );
  end if;

  return v_completed;
end;
$$;

-- Pausa la conversación, crea el evento y marca el lead dentro de una única transacción.
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
begin
  -- `wa_id` es un identificador numérico firmado por Meta. Se usa el mismo rango acotado que el
  -- normalizador y el outbox; no se lo interpreta como validación de un número E.164 ingresado.
  if p_phone is null or p_phone !~ '^[0-9]{6,20}$' then
    raise exception 'invalid_phone';
  end if;
  if p_source_wa_message_id is not null and length(p_source_wa_message_id) > 512 then
    raise exception 'invalid_source_wa_message_id';
  end if;

  update whatsapp_sessions
  set handoff_previous_state = case
        when state in ('handoff_pending', 'human_active', 'closed')
          then coalesce(handoff_previous_state, 'nuevo')
        else state
      end,
      state = 'handoff_pending',
      bot_paused = true,
      handoff_started_at = now(),
      state_version = state_version + 1,
      updated_at = now()
  where phone = p_phone;

  if not found then
    insert into whatsapp_sessions (
      phone, state, bot_paused, handoff_previous_state, handoff_started_at, state_version
    ) values (
      p_phone, 'handoff_pending', true, 'nuevo', now(), 1
    );
  end if;

  insert into handoff_events (
    lead_id, reason, summary, messages_sent_count, cost_estimated_total, source_wa_message_id
  ) values (
    p_lead_id, p_reason, coalesce(p_summary, '{}'::jsonb),
    greatest(coalesce(p_messages_sent_count, 0), 0), p_cost_estimated_total,
    p_source_wa_message_id
  ) on conflict do nothing;
  v_inserted := found;

  if p_lead_id is not null then
    update leads
    set requires_human = true,
        status = case when p_reason = 'urgencia_medica' then 'urgencia_derivada' else status end,
        updated_at = now()
    where id = p_lead_id;
  end if;
  return v_inserted;
end;
$$;

-- Acciones inequívocas del Inbox: tomar, resolver/reactivar o cerrar.
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
  if p_action not in ('take', 'reactivate', 'close') then
    raise exception 'invalid_handoff_action';
  end if;

  select phone into v_phone from leads where id = p_lead_id;
  if v_phone is null then
    raise exception 'whatsapp_lead_not_found';
  end if;

  if p_action = 'take' then
    update handoff_events
    set taken_at = coalesce(taken_at, now()),
        taken_by = coalesce(taken_by, p_actor)
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
            ) then handoff_previous_state
            else 'nuevo'
          end,
          bot_paused = false,
          handoff_previous_state = null,
          handoff_started_at = null,
          state_version = state_version + 1,
          updated_at = now()
      where phone = v_phone;
    else
      update whatsapp_sessions
      set state = 'closed', bot_paused = true,
          handoff_previous_state = null,
          handoff_started_at = null,
          state_version = state_version + 1,
          updated_at = now()
      where phone = v_phone;
    end if;
  end if;
end;
$$;

revoke all on function create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text)
  to service_role;

revoke all on function transition_whatsapp_handoff(uuid, text, text)
  from public, anon, authenticated;
grant execute on function transition_whatsapp_handoff(uuid, text, text)
  to service_role;

revoke all on function claim_whatsapp_followup(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function claim_whatsapp_followup(uuid, timestamptz)
  to service_role;

revoke all on function complete_whatsapp_followup(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function complete_whatsapp_followup(uuid, text, timestamptz)
  to service_role;
