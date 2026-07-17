import type { SupabaseClient } from "@supabase/supabase-js"

// Política DATA-02: leads administrativos sin actividad se eliminan después de 24 meses.
export const RETENTION_INACTIVITY_MONTHS = 24
export const WHATSAPP_PROCESSED_EVENT_RETENTION_DAYS = 30
export const WHATSAPP_DEAD_LETTER_RETENTION_DAYS = 90
export const WHATSAPP_SHADOW_RETENTION_DAYS = 180
export const WHATSAPP_DELIVERY_STATUS_RETENTION_DAYS = 180
export const WHATSAPP_HANDOFF_MESSAGE_RETENTION_DAYS = 30
export const WHATSAPP_OUTBOUND_LEDGER_RETENTION_DAYS = 180
export const SECURITY_AUDIT_RETENTION_MONTHS = 24
export const WHATSAPP_COST_EVENT_RETENTION_MONTHS = 24
export const WHATSAPP_ORPHAN_SESSION_RETENTION_DAYS = 30
export const WHATSAPP_ORPHAN_CONSENT_RETENTION_MONTHS = 24
const AUTO_RETENTION_ACTOR = "auto_retention_24m"

export interface RetentionCandidate {
  id: string
  protocol_interest: boolean
  protocol_name: string | null
  status: string
}

/** Los datos de investigación/protocolo quedan bajo resguardo y nunca se borran automáticamente. */
export function isClinicalOrProtocolLead(lead: RetentionCandidate): boolean {
  return lead.protocol_interest || lead.protocol_name !== null || lead.status === "elegible_protocolo"
}

export interface OperationalRetentionCounts {
  queue_processed_deleted: number
  queue_dead_letter_deleted: number
  shadow_deleted: number
  delivery_status_deleted: number
  outbound_ledger_deleted: number
  security_audit_deleted: number
  cost_events_deleted: number
  orphan_sessions_deleted: number
  orphan_consents_anonymized: number
  expired_leases_deleted: number
  handoff_messages_deleted: number
}

export interface DataRetentionSweepResult {
  erased: number
  blocked: number
  operational: OperationalRetentionCounts
  errors: string[]
}

const EMPTY_OPERATIONAL_COUNTS: OperationalRetentionCounts = {
  queue_processed_deleted: 0,
  queue_dead_letter_deleted: 0,
  shadow_deleted: 0,
  delivery_status_deleted: 0,
  outbound_ledger_deleted: 0,
  security_audit_deleted: 0,
  cost_events_deleted: 0,
  orphan_sessions_deleted: 0,
  orphan_consents_anonymized: 0,
  expired_leases_deleted: 0,
  handoff_messages_deleted: 0,
}

function parseOperationalCounts(data: unknown): OperationalRetentionCounts {
  const row = (Array.isArray(data) ? data[0] : data) as Partial<OperationalRetentionCounts> | null
  if (!row) return { ...EMPTY_OPERATIONAL_COUNTS }
  return {
    queue_processed_deleted: Number(row.queue_processed_deleted ?? 0),
    queue_dead_letter_deleted: Number(row.queue_dead_letter_deleted ?? 0),
    shadow_deleted: Number(row.shadow_deleted ?? 0),
    delivery_status_deleted: Number(row.delivery_status_deleted ?? 0),
    outbound_ledger_deleted: Number(row.outbound_ledger_deleted ?? 0),
    security_audit_deleted: Number(row.security_audit_deleted ?? 0),
    cost_events_deleted: Number(row.cost_events_deleted ?? 0),
    orphan_sessions_deleted: Number(row.orphan_sessions_deleted ?? 0),
    orphan_consents_anonymized: Number(row.orphan_consents_anonymized ?? 0),
    expired_leases_deleted: Number(row.expired_leases_deleted ?? 0),
    handoff_messages_deleted: Number(row.handoff_messages_deleted ?? 0),
  }
}

/**
 * Ejecuta en el cron semanal existente tanto la política de leads como la limpieza técnica de
 * cola/shadow. Los errores devueltos son códigos cerrados: nunca incluyen UUID, teléfono ni el
 * mensaje crudo del proveedor/base de datos.
 */
export async function runDataRetentionSweep(supabase: SupabaseClient): Promise<DataRetentionSweepResult> {
  const { data, error } = await supabase.rpc("find_leads_past_retention_threshold", {
    p_inactivity_months: RETENTION_INACTIVITY_MONTHS,
  })
  if (error) throw new Error("retention_lookup_failed")

  let erased = 0
  let blocked = 0
  const errors: string[] = []

  for (const [index, lead] of ((data ?? []) as RetentionCandidate[]).entries()) {
    try {
      if (isClinicalOrProtocolLead(lead)) {
        const { error: updateError } = await supabase
          .from("leads")
          .update({ consent_to_contact: false, retention_hold: true })
          .eq("id", lead.id)
        if (updateError) throw new Error("retention_hold_update_failed")
        blocked++
      } else {
        const { error: eraseError } = await supabase.rpc("erase_lead", {
          p_lead_id: lead.id,
          p_performed_by: AUTO_RETENTION_ACTOR,
        })
        if (eraseError) throw new Error("retention_erasure_failed")
        erased++
      }
    } catch (caught) {
      const code = caught instanceof Error
        && /^(?:retention_hold_update_failed|retention_erasure_failed)$/.test(caught.message)
        ? caught.message
        : "retention_candidate_failed"
      errors.push(`candidate_${index + 1}:${code}`)
    }
  }

  let operational = { ...EMPTY_OPERATIONAL_COUNTS }
  const { data: operationalData, error: operationalError } = await supabase.rpc(
    "run_whatsapp_operational_retention",
    {
      p_processed_days: WHATSAPP_PROCESSED_EVENT_RETENTION_DAYS,
      p_dead_letter_days: WHATSAPP_DEAD_LETTER_RETENTION_DAYS,
      p_shadow_days: WHATSAPP_SHADOW_RETENTION_DAYS,
      p_delivery_status_days: WHATSAPP_DELIVERY_STATUS_RETENTION_DAYS,
      p_outbound_ledger_days: WHATSAPP_OUTBOUND_LEDGER_RETENTION_DAYS,
      p_security_audit_months: SECURITY_AUDIT_RETENTION_MONTHS,
      p_cost_event_months: WHATSAPP_COST_EVENT_RETENTION_MONTHS,
      p_orphan_session_days: WHATSAPP_ORPHAN_SESSION_RETENTION_DAYS,
      p_orphan_consent_months: WHATSAPP_ORPHAN_CONSENT_RETENTION_MONTHS,
    }
  )
  if (operationalError) {
    errors.push("operational_cleanup_failed")
  } else {
    operational = parseOperationalCounts(operationalData)
  }

  const { data: handoffDeleted, error: handoffError } = await supabase.rpc(
    "run_whatsapp_handoff_message_retention",
    { p_retention_days: WHATSAPP_HANDOFF_MESSAGE_RETENTION_DAYS }
  )
  if (handoffError) {
    errors.push("handoff_message_cleanup_failed")
  } else {
    const count = Number(handoffDeleted ?? 0)
    operational.handoff_messages_deleted = Number.isFinite(count) ? count : 0
  }

  return { erased, blocked, operational, errors }
}
