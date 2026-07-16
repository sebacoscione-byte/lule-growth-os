-- ============================================================
-- Fases 2-5: evaluación shadow y rollout auditable sin PII
--
-- No activa el motor v2 ni modifica respuestas productivas. La configuración
-- de rollout conserva 0% por defecto en app_config; esta tabla registra solo
-- hashes no reversibles y decisiones de enums cerrados.
-- ============================================================

create table if not exists whatsapp_policy_evaluations (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique check (event_hash ~ '^[a-f0-9]{64}$'),
  conversation_hash text not null check (conversation_hash ~ '^[a-f0-9]{64}$'),
  initial_state text not null check (initial_state in (
    'new', 'awaiting_consent', 'awaiting_service', 'awaiting_coverage',
    'awaiting_location', 'ready_to_route', 'routed', 'handoff_pending',
    'human_active', 'closed', 'opted_out'
  )),
  input_type text not null check (input_type in (
    'text', 'button', 'list', 'audio', 'image', 'document', 'sticker',
    'video', 'location', 'contact', 'unknown'
  )),
  legacy_action text not null,
  legacy_intent text not null,
  legacy_response_key text not null,
  legacy_handoff boolean not null,
  candidate_action text not null,
  candidate_intent text not null,
  candidate_response_key text not null,
  candidate_handoff boolean not null,
  action_match boolean not null,
  intent_match boolean not null,
  response_match boolean not null,
  handoff_match boolean not null,
  policy_version text not null,
  nlu_schema_version text not null,
  catalog_version text not null,
  rollout_bucket smallint not null check (rollout_bucket between 0 and 99),
  served_by text not null check (served_by in ('legacy', 'policy_v2')),
  created_at timestamptz not null default now()
);

alter table whatsapp_policy_evaluations
  add constraint whatsapp_policy_evaluations_actions_check check (
    legacy_action in ('continue', 'emergency', 'handoff', 'opt_out', 'stop_bot', 'ask_clarification')
    and candidate_action in ('continue', 'emergency', 'handoff', 'opt_out', 'stop_bot', 'ask_clarification')
  ),
  add constraint whatsapp_policy_evaluations_intents_check check (
    legacy_intent in (
      'greeting', 'thanks', 'goodbye', 'affirmation', 'negation', 'small_talk',
      'complaint', 'clarification_request', 'request_appointment', 'cardiology_consult',
      'echocardiogram', 'both_services', 'insurance_coverage', 'private_payment',
      'location', 'opening_days_hours', 'booking_channel', 'cancel_or_reschedule',
      'appointment_already_solved', 'followup_status', 'doctor_information',
      'research_protocol', 'exam_preparation', 'send_documents', 'symptom_question',
      'medication_question', 'test_interpretation', 'diagnosis_question',
      'treatment_question', 'post_consultation_clinical_question', 'wrong_number',
      'caregiver_or_third_party', 'unsupported_media', 'abuse_or_spam', 'unknown'
    )
    and candidate_intent in (
      'greeting', 'thanks', 'goodbye', 'affirmation', 'negation', 'small_talk',
      'complaint', 'clarification_request', 'request_appointment', 'cardiology_consult',
      'echocardiogram', 'both_services', 'insurance_coverage', 'private_payment',
      'location', 'opening_days_hours', 'booking_channel', 'cancel_or_reschedule',
      'appointment_already_solved', 'followup_status', 'doctor_information',
      'research_protocol', 'exam_preparation', 'send_documents', 'symptom_question',
      'medication_question', 'test_interpretation', 'diagnosis_question',
      'treatment_question', 'post_consultation_clinical_question', 'wrong_number',
      'caregiver_or_third_party', 'unsupported_media', 'abuse_or_spam', 'unknown'
    )
  ),
  add constraint whatsapp_policy_evaluations_response_keys_check check (
    legacy_response_key in (
      'consent_request', 'consent_declined', 'ask_service', 'ask_coverage',
      'ask_location', 'show_booking_instructions', 'route_cimel', 'route_britanico',
      'route_swiss', 'greeting_existing', 'thanks_close', 'human_handoff',
      'human_pending', 'medical_boundary', 'possible_emergency', 'emergency_ambiguous',
      'opt_out_confirmed', 'opt_out_protocol', 'unsupported_media',
      'wrong_number_confirmed', 'caregiver_clarification', 'ask_clarification',
      'ask_rephrase', 'coverage_not_verified'
    )
    and candidate_response_key in (
      'consent_request', 'consent_declined', 'ask_service', 'ask_coverage',
      'ask_location', 'show_booking_instructions', 'route_cimel', 'route_britanico',
      'route_swiss', 'greeting_existing', 'thanks_close', 'human_handoff',
      'human_pending', 'medical_boundary', 'possible_emergency', 'emergency_ambiguous',
      'opt_out_confirmed', 'opt_out_protocol', 'unsupported_media',
      'wrong_number_confirmed', 'caregiver_clarification', 'ask_clarification',
      'ask_rephrase', 'coverage_not_verified'
    )
  );

comment on table whatsapp_policy_evaluations is
  'Métricas shadow/canary sin texto, teléfono, nombre ni identificadores reversibles.';

create index if not exists whatsapp_policy_evaluations_created_idx
  on whatsapp_policy_evaluations(created_at desc);
create index if not exists whatsapp_policy_evaluations_matches_idx
  on whatsapp_policy_evaluations(action_match, intent_match, response_match, created_at desc);

alter table whatsapp_policy_evaluations enable row level security;
alter table whatsapp_policy_evaluations force row level security;

drop policy if exists "service_role_only_whatsapp_policy_evaluations"
  on whatsapp_policy_evaluations;
create policy "service_role_only_whatsapp_policy_evaluations"
  on whatsapp_policy_evaluations
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table whatsapp_policy_evaluations from public, anon, authenticated;
grant select, insert, update, delete on table whatsapp_policy_evaluations to service_role;

-- Phase 1E defines the shared suppression function before this table exists. Install the trigger
-- here so the documented migration order works on a clean database.
drop trigger if exists block_erased_whatsapp_policy_hash on whatsapp_policy_evaluations;
create trigger block_erased_whatsapp_policy_hash
  before insert or update of conversation_hash on whatsapp_policy_evaluations
  for each row execute function block_erased_whatsapp_hash_write();
