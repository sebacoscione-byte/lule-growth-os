-- ============================================================
-- Privacidad, roles y retención operativa del canal WhatsApp.
--
-- Compatibilidad: `enforce_roles` y MFA nacen apagados. Antes de activarlos hay que asignar
-- app_metadata.role a cada usuario en Auth (nunca user_metadata) y enrolar MFA. La activación
-- explícita se hace actualizando la única fila de security_authorization_settings con service_role.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists security_authorization_settings (
  id text primary key check (id = 'global'),
  enforce_roles boolean not null default false,
  require_mfa_for_sensitive_actions boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into security_authorization_settings (
  id, enforce_roles, require_mfa_for_sensitive_actions
) values ('global', false, false)
on conflict (id) do nothing;

alter table security_authorization_settings enable row level security;
alter table security_authorization_settings force row level security;
drop policy if exists "service_role_all_security_authorization_settings"
  on security_authorization_settings;
create policy "service_role_all_security_authorization_settings"
  on security_authorization_settings for all to service_role using (true) with check (true);
revoke all on table security_authorization_settings from public, anon, authenticated;
grant select, insert, update, delete on table security_authorization_settings to service_role;

create or replace function current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.jwt() -> 'app_metadata' ->> 'role' in ('owner', 'doctor', 'reception', 'research', 'viewer')
      then auth.jwt() -> 'app_metadata' ->> 'role'
    else null
  end
$$;

create or replace function security_role_allowed(p_roles text[], p_sensitive boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from security_authorization_settings where id = 'global')
    and (
      (
        not coalesce((select enforce_roles from security_authorization_settings where id = 'global'), true)
        and current_staff_role() is null
      )
      or current_staff_role() = any(p_roles)
    )
    and (
      not coalesce(p_sensitive, false)
      or not coalesce((
        select require_mfa_for_sensitive_actions
        from security_authorization_settings where id = 'global'
      ), true)
      or auth.jwt() ->> 'aal' = 'aal2'
    )
$$;

revoke all on function current_staff_role() from public, anon;
revoke all on function security_role_allowed(text[], boolean) from public, anon;
grant execute on function current_staff_role() to authenticated, service_role;
grant execute on function security_role_allowed(text[], boolean) to authenticated, service_role;

-- Auditoría de acciones sensibles: solo identidad interna del operador, enums, hashes SHA-256 y
-- metadata administrativa cerrada. Nunca texto del paciente, teléfono, nombre ni email.
create table if not exists security_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_role text not null check (actor_role in ('owner', 'doctor', 'reception', 'research', 'viewer')),
  action text not null check (action in (
    'manual_message_send', 'handoff_take', 'handoff_reactivate', 'handoff_close',
    'bot_pause', 'bot_reactivate', 'config_update', 'lead_export',
    'lead_correction', 'lead_erasure_request'
  )),
  resource_type text not null check (resource_type in (
    'lead', 'whatsapp_conversation', 'configuration', 'lead_collection'
  )),
  resource_ref text check (resource_ref is null or resource_ref ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists security_audit_log_created_at_idx
  on security_audit_log(created_at desc);
create index if not exists security_audit_log_actor_idx
  on security_audit_log(actor_user_id, created_at desc);

alter table security_audit_log enable row level security;
alter table security_audit_log force row level security;
drop policy if exists "service_role_all_security_audit_log" on security_audit_log;
create policy "service_role_all_security_audit_log"
  on security_audit_log for all to service_role using (true) with check (true);
revoke all on table security_audit_log from public, anon, authenticated;
grant select, insert, update, delete on table security_audit_log to service_role;

-- RLS con transición segura: mientras enforce_roles=false conserva el acceso autenticado previo;
-- al activarlo, el JWT debe traer app_metadata.role. Las mutaciones sensibles además respetan AAL2.
drop policy if exists "Authenticated users can do everything on leads" on leads;
create policy "staff_read_leads" on leads for select to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_insert_leads" on leads for insert to authenticated
  with check (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_update_leads" on leads for update to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true))
  with check (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_delete_leads" on leads for delete to authenticated
  using (security_role_allowed(array['owner','doctor'], true));

drop policy if exists "Authenticated users can do everything on messages" on messages;
create policy "staff_read_messages" on messages for select to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_insert_messages" on messages for insert to authenticated
  with check (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_update_messages" on messages for update to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true))
  with check (security_role_allowed(array['owner','doctor','reception'], true));
create policy "staff_delete_messages" on messages for delete to authenticated
  using (security_role_allowed(array['owner','doctor'], true));

drop policy if exists "Authenticated users can do everything on config" on app_config;
drop policy if exists "authenticated read app_config" on app_config;
drop policy if exists "authenticated write app_config" on app_config;
drop policy if exists "authenticated update app_config" on app_config;
drop policy if exists "authenticated delete app_config" on app_config;
create policy "staff_read_app_config" on app_config for select to authenticated
  using (
    key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])
    and security_role_allowed(array['owner','doctor'], false)
  );
create policy "owner_insert_app_config" on app_config for insert to authenticated
  with check (
    key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])
    and (
      (key = 'content_pipeline' and security_role_allowed(array['owner','doctor'], true))
      or (key <> 'content_pipeline' and security_role_allowed(array['owner'], true))
    )
  );
create policy "owner_update_app_config" on app_config for update to authenticated
  using (
    key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])
    and (
      (key = 'content_pipeline' and security_role_allowed(array['owner','doctor'], true))
      or (key <> 'content_pipeline' and security_role_allowed(array['owner'], true))
    )
  )
  with check (
    key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])
    and (
      (key = 'content_pipeline' and security_role_allowed(array['owner','doctor'], true))
      or (key <> 'content_pipeline' and security_role_allowed(array['owner'], true))
    )
  );
create policy "owner_delete_app_config" on app_config for delete to authenticated
  using (
    key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])
    and (
      (key = 'content_pipeline' and security_role_allowed(array['owner','doctor'], true))
      or (key <> 'content_pipeline' and security_role_allowed(array['owner'], true))
    )
  );

drop policy if exists "authenticated_read_whatsapp_sessions" on whatsapp_sessions;
create policy "staff_read_whatsapp_sessions" on whatsapp_sessions for select to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true));

drop policy if exists "authenticated_read_handoff_events" on handoff_events;
drop policy if exists "authenticated_update_handoff_events" on handoff_events;
create policy "staff_read_handoff_events" on handoff_events for select to authenticated
  using (security_role_allowed(array['owner','doctor','reception'], true));

drop policy if exists "authenticated_read_consent_records" on consent_records;
create policy "staff_read_consent_records" on consent_records for select to authenticated
  using (security_role_allowed(array['owner','doctor'], true));

drop policy if exists "authenticated_all_templates" on templates;
create policy "staff_read_templates" on templates for select to authenticated
  using (security_role_allowed(array['owner','doctor'], false));
create policy "owner_insert_templates" on templates for insert to authenticated
  with check (security_role_allowed(array['owner'], true));
create policy "owner_update_templates" on templates for update to authenticated
  using (security_role_allowed(array['owner'], true))
  with check (security_role_allowed(array['owner'], true));
create policy "owner_delete_templates" on templates for delete to authenticated
  using (security_role_allowed(array['owner'], true));

drop policy if exists "authenticated_read_whatsapp_pricing_rules" on whatsapp_pricing_rules;
drop policy if exists "authenticated_write_whatsapp_pricing_rules" on whatsapp_pricing_rules;
create policy "staff_read_whatsapp_pricing_rules" on whatsapp_pricing_rules for select to authenticated
  using (security_role_allowed(array['owner','doctor'], false));
create policy "owner_update_whatsapp_pricing_rules" on whatsapp_pricing_rules for update to authenticated
  using (security_role_allowed(array['owner'], true))
  with check (security_role_allowed(array['owner'], true));

drop policy if exists "authenticated_read_whatsapp_cost_events" on whatsapp_cost_events;
create policy "staff_read_whatsapp_cost_events" on whatsapp_cost_events for select to authenticated
  using (security_role_allowed(array['owner','doctor'], true));

-- El dashboard solo necesita distinguir conversaciones para agregados. Seudonimiza cualquier
-- identificador legacy que todavía esté en claro; los nuevos inserts ya llegan hasheados.
update whatsapp_cost_events
set wa_id = encode(digest(wa_id, 'sha256'), 'hex')
where wa_id <> 'erased'
  and wa_id !~ '^[0-9a-f]{64}$';

drop policy if exists "authenticated_read_ai_requests" on ai_requests;
drop policy if exists "authenticated_read_ai_outputs" on ai_outputs;
create policy "clinical_staff_read_ai_requests" on ai_requests for select to authenticated
  using (security_role_allowed(array['owner','doctor'], true));
create policy "clinical_staff_read_ai_outputs" on ai_outputs for select to authenticated
  using (security_role_allowed(array['owner','doctor'], true));

drop policy if exists "authenticated_read_app_config_history" on app_config_history;
drop policy if exists "owner_read_app_config_history" on app_config_history;

-- El historial sólo conserva configuración no secreta. Tokens, IDs OAuth y credenciales nunca se
-- copian a otra tabla. El historial queda reservado a service_role para evitar una vía lateral de
-- lectura desde el navegador aun si una política futura de app_config se amplía por error.
create or replace function log_app_config_change() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline']) then
    insert into app_config_history (key, value) values (old.key, old.value);
  end if;
  return new;
end;
$$;
revoke all on function log_app_config_change() from public, anon, authenticated;

-- Reemplazar primero la función del trigger cierra la ventana en la que un UPDATE concurrente
-- podía volver a copiar un secreto después de la purga.
delete from app_config_history
where key <> all(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline']);

alter table app_config_history force row level security;
drop policy if exists "service_role_all_app_config_history" on app_config_history;
create policy "service_role_all_app_config_history"
  on app_config_history for all to service_role using (true) with check (true);
revoke all on table app_config_history from public, anon, authenticated;
grant select, insert, update, delete on table app_config_history to service_role;

-- El log histórico de borrado contenía el UUID del lead y a veces el email del operador. Se
-- reemplazan ambos por seudónimos deterministas y se mantiene la función atómica de borrado.
alter table data_erasure_log
  add column if not exists lead_ref text,
  add column if not exists performed_by_ref text;

update data_erasure_log
set lead_ref = coalesce(lead_ref, encode(digest(lead_id::text, 'sha256'), 'hex')),
    performed_by_ref = coalesce(performed_by_ref, encode(digest(performed_by, 'sha256'), 'hex'));

alter table data_erasure_log alter column lead_ref set not null;
alter table data_erasure_log alter column performed_by_ref set not null;
alter table data_erasure_log drop column if exists lead_id;
alter table data_erasure_log drop column if exists performed_by;

drop policy if exists "authenticated_read_data_erasure_log" on data_erasure_log;
drop policy if exists "service_role_all_data_erasure_log" on data_erasure_log;
create policy "service_role_all_data_erasure_log"
  on data_erasure_log for all to service_role using (true) with check (true);
revoke all on table data_erasure_log from public, anon, authenticated;
grant select, insert, update, delete on table data_erasure_log to service_role;

create or replace function erase_lead(p_lead_id uuid, p_performed_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_phone_hash text;
  v_identifier text;
begin
  -- Freeze the contact identity before deriving partition locks and collecting related rows.
  -- This prevents a concurrent phone correction from moving data outside the erasure set.
  select phone into v_phone from leads where id = p_lead_id for update;
  if not found then raise exception 'lead_not_found'; end if;

  if v_phone is not null then
    v_phone_hash := encode(digest(v_phone, 'sha256'), 'hex');
    -- Same partition lock used by queue/contact/outbox triggers. This closes the visibility gap
    -- between collecting stable identifiers and deleting the rows linked to this destination.
    perform pg_advisory_xact_lock(hashtextextended('whatsapp-erasure:' || v_phone_hash, 0));
    -- Never confirm an erasure while a recent Meta dispatch for this destination is known to be
    -- in flight. The caller receives a retryable conflict; old crashed claims stop blocking after
    -- a conservative two-minute ceiling (the HTTP provider timeout is ten seconds).
    if exists (
      select 1 from whatsapp_outbound_ledger
      where destination_hash = v_phone_hash
        and status = 'dispatching'
        and coalesce(dispatch_started_at, created_at) > now() - interval '2 minutes'
    ) then
      raise exception 'whatsapp_erasure_dispatch_in_flight';
    end if;
    -- Suppress serverless work already in flight before deleting any row. The raw identifiers are
    -- HMACed inside the helper and never stored in the tombstone table.
    -- Manual/landing leads historically accepted formatted phones; that must never make the
    -- general erasure operation fail. Only canonical WhatsApp identities need contact suppression.
    if v_phone ~ '^[0-9]{6,20}$' then
      perform create_whatsapp_erasure_tombstone('phone', v_phone);
    end if;

    for v_identifier in
      select wa_message_id from whatsapp_webhook_events
      where phone = v_phone or phone_hash = v_phone_hash
      union
      select related_wa_message_id from whatsapp_webhook_events
      where phone = v_phone or phone_hash = v_phone_hash
      union
      select wa_message_id from messages
      where lead_id = p_lead_id and wa_message_id is not null
      union
      select wa_message_id from whatsapp_cost_events
      where (lead_id = p_lead_id or wa_id = v_phone_hash) and wa_message_id is not null
      union
      select evidence_message_id from consent_records
      where (lead_id = p_lead_id or wa_id = v_phone) and evidence_message_id is not null
      union
      select source_wa_message_id from handoff_events
      where lead_id = p_lead_id and source_wa_message_id is not null
      union
      select wa_message_id from whatsapp_outbound_ledger
      where destination_hash = v_phone_hash and wa_message_id is not null
    loop
      if nullif(v_identifier, '') is not null then
        perform create_whatsapp_erasure_tombstone('event', v_identifier);
      end if;
    end loop;

    for v_identifier in
      select dedupe_key from whatsapp_outbound_ledger where destination_hash = v_phone_hash
    loop
      perform create_whatsapp_erasure_tombstone('outbound', v_identifier);
    end loop;
  end if;

  delete from whatsapp_message_status_events
  where wa_message_id in (
    select related_wa_message_id from whatsapp_webhook_events
    where v_phone is not null and (phone = v_phone or phone_hash = v_phone_hash)
    union
    select wa_message_id from messages
    where lead_id = p_lead_id and wa_message_id is not null
    union
    select wa_message_id from whatsapp_cost_events
    where (lead_id = p_lead_id or (v_phone_hash is not null and wa_id = v_phone_hash))
      and wa_message_id is not null
    union
    select wa_message_id from whatsapp_outbound_ledger
    where v_phone_hash is not null
      and destination_hash = v_phone_hash
      and wa_message_id is not null
  );
  delete from handoff_events where lead_id = p_lead_id;
  delete from messages where lead_id = p_lead_id;
  update whatsapp_cost_events
  set wa_id = 'erased', wa_message_id = null, outbound_ledger_key = null
  where lead_id = p_lead_id
     or (v_phone_hash is not null and wa_id = v_phone_hash);
  update consent_records
  set wa_id = 'erased', evidence_message_id = null
  where lead_id = p_lead_id
     or (v_phone is not null and wa_id = v_phone);

  if v_phone is not null then
    delete from whatsapp_webhook_events
    where phone = v_phone or phone_hash = v_phone_hash;
    delete from whatsapp_conversation_leases where phone_hash = v_phone_hash;
    delete from whatsapp_outbound_ledger where destination_hash = v_phone_hash;
    delete from whatsapp_policy_evaluations where conversation_hash = v_phone_hash;
    delete from whatsapp_sessions
    where phone = v_phone and (lead_id is null or lead_id = p_lead_id);
  end if;

  delete from leads where id = p_lead_id;
  insert into data_erasure_log (lead_ref, performed_by_ref)
  values (
    encode(digest(p_lead_id::text, 'sha256'), 'hex'),
    encode(digest(coalesce(p_performed_by, 'unknown'), 'sha256'), 'hex')
  );
end;
$$;

revoke all on function erase_lead(uuid, text) from public, anon, authenticated;
grant execute on function erase_lead(uuid, text) to service_role;

-- Retención técnica dentro del cron semanal existente: las filas ya procesadas no conservan PII,
-- pero tampoco necesitan crecer sin límite. DLQ se conserva más tiempo para diagnóstico.
create or replace function run_whatsapp_operational_retention(
  p_processed_days integer default 30,
  p_dead_letter_days integer default 90,
  p_shadow_days integer default 180,
  p_delivery_status_days integer default 180,
  p_outbound_ledger_days integer default 180,
  p_security_audit_months integer default 24,
  p_cost_event_months integer default 24,
  p_orphan_session_days integer default 30,
  p_orphan_consent_months integer default 24
)
returns table (
  queue_processed_deleted bigint,
  queue_dead_letter_deleted bigint,
  shadow_deleted bigint,
  delivery_status_deleted bigint,
  outbound_ledger_deleted bigint,
  security_audit_deleted bigint,
  cost_events_deleted bigint,
  orphan_sessions_deleted bigint,
  orphan_consents_anonymized bigint,
  expired_leases_deleted bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  p_processed_days := greatest(7, least(coalesce(p_processed_days, 30), 365));
  p_dead_letter_days := greatest(30, least(coalesce(p_dead_letter_days, 90), 730));
  p_shadow_days := greatest(30, least(coalesce(p_shadow_days, 180), 730));
  p_delivery_status_days := greatest(30, least(coalesce(p_delivery_status_days, 180), 730));
  p_outbound_ledger_days := greatest(30, least(coalesce(p_outbound_ledger_days, 180), 730));
  p_security_audit_months := greatest(12, least(coalesce(p_security_audit_months, 24), 120));
  p_cost_event_months := greatest(12, least(coalesce(p_cost_event_months, 24), 120));
  p_orphan_session_days := greatest(7, least(coalesce(p_orphan_session_days, 30), 365));
  p_orphan_consent_months := greatest(12, least(coalesce(p_orphan_consent_months, 24), 120));

  delete from whatsapp_webhook_events
  where status = 'processed'
    and coalesce(processed_at, created_at) < now() - make_interval(days => p_processed_days);
  get diagnostics queue_processed_deleted = row_count;

  delete from whatsapp_webhook_events
  where status = 'dead_letter'
    and created_at < now() - make_interval(days => p_dead_letter_days);
  get diagnostics queue_dead_letter_deleted = row_count;

  delete from whatsapp_policy_evaluations
  where created_at < now() - make_interval(days => p_shadow_days);
  get diagnostics shadow_deleted = row_count;

  delete from whatsapp_message_status_events
  where created_at < now() - make_interval(days => p_delivery_status_days);
  get diagnostics delivery_status_deleted = row_count;

  delete from whatsapp_outbound_ledger
  where status <> 'dispatching'
    and updated_at < now() - make_interval(days => p_outbound_ledger_days);
  get diagnostics outbound_ledger_deleted = row_count;

  delete from security_audit_log
  where created_at < now() - make_interval(months => p_security_audit_months);
  get diagnostics security_audit_deleted = row_count;

  delete from whatsapp_cost_events
  where created_at < now() - make_interval(months => p_cost_event_months);
  get diagnostics cost_events_deleted = row_count;

  delete from whatsapp_sessions
  where lead_id is null
    and updated_at < now() - make_interval(days => p_orphan_session_days);
  get diagnostics orphan_sessions_deleted = row_count;

  update consent_records
  set wa_id = 'expired', evidence_message_id = null
  where lead_id is null
    and wa_id not in ('expired', 'erased')
    and created_at < now() - make_interval(months => p_orphan_consent_months);
  get diagnostics orphan_consents_anonymized = row_count;

  delete from whatsapp_conversation_leases where locked_until < now() - interval '1 day';
  get diagnostics expired_leases_deleted = row_count;

  delete from whatsapp_erasure_tombstones where expires_at <= now();

  return next;
end;
$$;

revoke all on function run_whatsapp_operational_retention(integer, integer, integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function run_whatsapp_operational_retention(integer, integer, integer, integer, integer, integer, integer, integer, integer)
  to service_role;

-- Activación posterior al onboarding (ejecutar con service_role, no desde el navegador):
-- update security_authorization_settings
-- set enforce_roles = true, require_mfa_for_sensitive_actions = true, updated_at = now()
-- where id = 'global';
