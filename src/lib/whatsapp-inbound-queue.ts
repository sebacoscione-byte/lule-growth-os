import { randomUUID } from "node:crypto"
import { getServiceDb } from "@/lib/supabase/service"
import { handleIncomingMessage, type WhatsAppInboundMessageType } from "@/lib/whatsapp-bot"
import {
  TemplateNotApprovedError,
  WhatsAppAutomaticDispatchSuppressedError,
  WhatsAppApiError,
  WhatsAppConfigurationError,
  WindowClosedError,
} from "@/lib/whatsapp"
import type { NormalizedWhatsAppEvent } from "@/lib/whatsapp-webhook-normalizer"
import { AmbiguousWhatsAppDeliveryError, RejectedWhatsAppDeliveryError } from "@/lib/whatsapp-outbox"
import {
  assertWhatsAppErasureNotSuppressed,
  WhatsAppErasureSuppressedError,
} from "@/lib/whatsapp-erasure-suppression"

const TABLE = "whatsapp_webhook_events"
const MAX_ATTEMPTS = 5
const DEFAULT_BATCH_SIZE = 20
const MAX_BATCH_SIZE = 200

export interface ClaimedWhatsAppEvent {
  id: string
  wa_message_id: string
  event_type: "inbound" | "status"
  related_wa_message_id: string
  phone: string | null
  phone_hash: string
  message_type: WhatsAppInboundMessageType | null
  message_text: string | null
  wa_name: string | null
  button_id: string | null
  referral: Record<string, string> | null
  delivery_status: "sent" | "delivered" | "read" | "failed" | "deleted" | "warning" | null
  status_error_code: string | null
  occurred_at: string | null
  batch_order: number
  attempts: number
  handler_completed_at: string | null
}

export interface WhatsAppQueueDrainResult {
  claimed: number
  processed: number
  retried: number
  deadLettered: number
}

export interface WhatsAppQueueHealth {
  deadLetterCount: number
  dueCount: number
}

export interface WhatsAppDeadLetterAlertClaim {
  claimToken: string
  eventCount: number
}

interface QueueProcessorDependencies {
  handleIncoming: typeof handleIncomingMessage
  /** Compatibility/test seam. Read receipts are deliberately disabled for erasure safety. */
  markRead?: (waMessageId: string) => Promise<unknown>
  applyStatus: (event: ClaimedWhatsAppEvent) => Promise<void>
  assertNotErased?: (event: ClaimedWhatsAppEvent) => Promise<void>
}

async function assertEventNotErased(event: ClaimedWhatsAppEvent): Promise<void> {
  await assertWhatsAppErasureNotSuppressed(event.phone, event.wa_message_id, event.occurred_at)
  // Status events have a synthetic queue key plus the provider message id they update. An old
  // provider status must stay suppressed even after the short phone tombstone expires.
  if (event.related_wa_message_id !== event.wa_message_id) {
    await assertWhatsAppErasureNotSuppressed(event.phone, event.related_wa_message_id, event.occurred_at)
  }
}

const defaultProcessorDependencies: QueueProcessorDependencies = {
  handleIncoming: handleIncomingMessage,
  applyStatus: applyWhatsAppDeliveryStatus,
  assertNotErased: assertEventNotErased,
}

export class PermanentWhatsAppQueueError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "PermanentWhatsAppQueueError"
  }
}

/** Backoff exponencial corto: 5s, 10s, 20s, 40s, luego DLQ al quinto intento. */
export function calculateWhatsAppRetryDelaySeconds(attempt: number): number {
  return Math.min(15 * 60, 5 * (2 ** Math.max(0, attempt - 1)))
}

/** Never returns provider bodies, patient text, phone numbers or arbitrary exception messages. */
export function sanitizeWhatsAppQueueError(error: unknown): string {
  if (error instanceof PermanentWhatsAppQueueError) return error.code.slice(0, 80)
  if (error instanceof WindowClosedError) return "window_closed"
  if (error instanceof TemplateNotApprovedError) return "template_not_approved"
  if (error instanceof WhatsAppConfigurationError) return error.code
  if (error instanceof AmbiguousWhatsAppDeliveryError) return error.code
  if (error instanceof RejectedWhatsAppDeliveryError) return "delivery_rejected"
  if (error instanceof WhatsAppApiError) {
    const providerCode = error.providerCode ? `_${String(error.providerCode).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30)}` : ""
    return `meta_api_${error.status}${providerCode}`.slice(0, 80)
  }
  if (error instanceof DOMException && error.name === "AbortError") return "upstream_timeout"
  return "internal_error"
}

export function isPermanentWhatsAppQueueError(error: unknown): boolean {
  if (error instanceof PermanentWhatsAppQueueError) return true
  if (error instanceof WindowClosedError || error instanceof TemplateNotApprovedError) return true
  if (error instanceof WhatsAppConfigurationError) return true
  if (error instanceof AmbiguousWhatsAppDeliveryError || error instanceof RejectedWhatsAppDeliveryError) return true
  if (error instanceof WhatsAppApiError) {
    return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429 && !error.isTransient
  }
  return false
}

function queueRow(event: NormalizedWhatsAppEvent) {
  return {
    wa_message_id: event.event_key,
    event_type: event.event_type,
    related_wa_message_id: event.related_wa_message_id,
    phone: event.phone,
    phone_hash: event.phone_hash,
    message_type: event.message_type,
    message_text: event.message_text,
    wa_name: event.wa_name,
    button_id: event.button_id,
    referral: event.referral,
    delivery_status: event.delivery_status,
    status_error_code: event.status_error_code,
    occurred_at: event.occurred_at,
    batch_order: event.batch_order,
    status: "pending",
    available_at: new Date().toISOString(),
  }
}

/** Durable boundary. The webhook only acknowledges after this upsert succeeds. */
export async function enqueueWhatsAppEvents(events: NormalizedWhatsAppEvent[]): Promise<number> {
  if (events.length === 0) return 0
  const { error } = await getServiceDb()
    .from(TABLE)
    .upsert(events.map(queueRow), { onConflict: "wa_message_id", ignoreDuplicates: true })
  if (error) throw new Error("whatsapp_queue_unavailable")
  return events.length
}

/** Sólo consulta conteos operativos; nunca selecciona teléfono, nombre ni contenido. */
export async function getWhatsAppQueueHealth(now: Date = new Date()): Promise<WhatsAppQueueHealth> {
  const db = getServiceDb()
  const { count: deadLetterCount, error: deadLetterError } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "dead_letter")
  if (deadLetterError) throw new Error("whatsapp_queue_health_failed")

  const { count: dueCount, error: dueError } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "retry"])
    .lte("available_at", now.toISOString())
  if (dueError) throw new Error("whatsapp_queue_health_failed")

  return { deadLetterCount: deadLetterCount ?? 0, dueCount: dueCount ?? 0 }
}

/** Leases a count-only DLQ alert batch; no patient envelope is selected. */
export async function claimWhatsAppDeadLetterAlerts(): Promise<WhatsAppDeadLetterAlertClaim> {
  const { data, error } = await getServiceDb().rpc("claim_whatsapp_dead_letter_alerts")
  const row = (Array.isArray(data) ? data[0] : data) as {
    claim_token?: unknown
    event_count?: unknown
  } | null
  if (
    error
    || typeof row?.claim_token !== "string"
    || !Number.isInteger(row.event_count)
    || Number(row.event_count) < 0
  ) throw new Error("whatsapp_dlq_alert_claim_failed")
  return { claimToken: row.claim_token, eventCount: Number(row.event_count) }
}

/** A provider failure releases the lease; only confirmed delivery sets alerted_at. */
export async function finalizeWhatsAppDeadLetterAlert(
  claimToken: string,
  delivered: boolean
): Promise<void> {
  const { error } = await getServiceDb().rpc("finalize_whatsapp_dead_letter_alert", {
    p_claim_token: claimToken,
    p_delivered: delivered,
  })
  if (error) throw new Error("whatsapp_dlq_alert_finalize_failed")
}

export async function applyWhatsAppDeliveryStatus(event: ClaimedWhatsAppEvent): Promise<void> {
  if (!event.delivery_status) throw new PermanentWhatsAppQueueError("invalid_status_event")
  const { error } = await getServiceDb().rpc("apply_whatsapp_delivery_status", {
    p_wa_message_id: event.related_wa_message_id,
    p_status: event.delivery_status,
    p_occurred_at: event.occurred_at,
    p_error_code: event.status_error_code,
  })
  if (error) throw new Error("delivery_status_write_failed")
  const { error: reconcileError } = await getServiceDb().rpc("reconcile_whatsapp_outbound_acceptance", {
    p_wa_message_id: event.related_wa_message_id,
  })
  if (reconcileError) throw new Error("delivery_status_reconcile_failed")
}

export async function processClaimedWhatsAppEvent(
  event: ClaimedWhatsAppEvent,
  dependencies: QueueProcessorDependencies = defaultProcessorDependencies
): Promise<void> {
  if (dependencies.assertNotErased) await dependencies.assertNotErased(event)

  if (event.event_type === "status") {
    await dependencies.applyStatus(event)
    return
  }

  if (!event.phone || !event.message_type) {
    throw new PermanentWhatsAppQueueError("invalid_inbound_envelope")
  }

  // No automatic read receipt: it is cosmetic, has no durable ledger, and would introduce an
  // avoidable external side effect in the narrow interval around a data-erasure request.
  await dependencies.handleIncoming({
    phone: event.phone,
    text: event.message_text ?? "",
    waName: event.wa_name ?? undefined,
    messageType: event.message_type,
    buttonId: event.button_id ?? undefined,
    waMessageId: event.related_wa_message_id,
    referral: event.referral ?? undefined,
  })
}

async function claimNextEvent(workerId: string): Promise<ClaimedWhatsAppEvent | null> {
  const { data, error } = await getServiceDb().rpc("claim_whatsapp_webhook_event", {
    p_worker_id: workerId,
    p_lease_seconds: 120,
  })
  if (error) throw new Error("whatsapp_queue_claim_failed")
  const row = Array.isArray(data) ? data[0] : data
  return row ? row as ClaimedWhatsAppEvent : null
}

async function completeEvent(eventId: string, workerId: string): Promise<void> {
  const { data, error } = await getServiceDb().rpc("complete_whatsapp_webhook_event", {
    p_event_id: eventId,
    p_worker_id: workerId,
  })
  if (error || data !== true) throw new Error("whatsapp_queue_complete_failed")
}

async function completeErasedEvent(event: ClaimedWhatsAppEvent, workerId: string): Promise<void> {
  const { data, error } = await getServiceDb().rpc("complete_erased_whatsapp_webhook_event", {
    p_event_id: event.id,
    p_worker_id: workerId,
    p_source_key: event.wa_message_id,
    p_related_source_key: event.related_wa_message_id,
  })
  if (error || data !== true) throw new Error("whatsapp_erasure_complete_failed")
}

async function checkpointCompletedHandler(eventId: string, workerId: string): Promise<void> {
  const { data, error } = await getServiceDb().rpc("checkpoint_whatsapp_webhook_handler", {
    p_event_id: eventId,
    p_worker_id: workerId,
  })
  if (error || data !== true) throw new Error("whatsapp_queue_checkpoint_failed")
}

async function failEvent(event: ClaimedWhatsAppEvent, workerId: string, error: unknown): Promise<"retry" | "dead_letter"> {
  const permanent = isPermanentWhatsAppQueueError(error)
  const shouldDeadLetter = permanent || event.attempts >= MAX_ATTEMPTS
  const { data, error: writeError } = await getServiceDb().rpc("fail_whatsapp_webhook_event", {
    p_event_id: event.id,
    p_worker_id: workerId,
    p_error_code: sanitizeWhatsAppQueueError(error),
    p_permanent: shouldDeadLetter,
    p_retry_delay_seconds: calculateWhatsAppRetryDelaySeconds(event.attempts),
  })
  if (writeError) throw new Error("whatsapp_queue_failure_write_failed")
  return data === "dead_letter" || shouldDeadLetter ? "dead_letter" : "retry"
}

export async function quarantineAmbiguousOutbound(event: ClaimedWhatsAppEvent, error: AmbiguousWhatsAppDeliveryError): Promise<void> {
  if (!event.phone) throw new Error("ambiguous_delivery_quarantine_failed")
  const { data, error: writeError } = await getServiceDb().rpc("quarantine_whatsapp_ambiguous_delivery", {
    p_phone: event.phone,
    p_dedupe_key: error.ledgerKey,
    p_error_code: error.code,
  })
  if (writeError || data !== true) throw new Error("ambiguous_delivery_quarantine_failed")
}

/**
 * Claims one event at a time. The SQL lease keeps all events for a phone serialized even when
 * several `after()` callbacks or internal workers overlap.
 *
 * La cola entrante es at-least-once. El ledger de salida reclama una intención estable antes de
 * llamar a Meta y evita repetirla automáticamente al reprocesar el evento; si el resultado externo
 * queda ambiguo, congela la intención y deriva a revisión humana en vez de reenviar a ciegas.
 */
export async function drainWhatsAppInboundQueue(options: {
  maxEvents?: number
  workerId?: string
  timeBudgetMs?: number
} = {}): Promise<WhatsAppQueueDrainResult> {
  const maxEvents = Math.max(1, Math.min(options.maxEvents ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE))
  const workerId = options.workerId ?? randomUUID()
  const startedAt = Date.now()
  const timeBudgetMs = Math.max(1_000, Math.min(options.timeBudgetMs ?? 45_000, 150_000))
  const result: WhatsAppQueueDrainResult = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 }

  // Also freezes orphaned proactive/manual dispatch attempts and creates a technical handoff when
  // a destination can be mapped to an active session. This is idempotent and runs in the same
  // existing worker/cron path, without adding another scheduled job.
  try {
    const { error: outboxRecoveryError } = await getServiceDb().rpc("recover_stale_whatsapp_outbound_intents")
    if (outboxRecoveryError) console.error("whatsapp_outbox_recovery_failed")
  } catch {
    console.error("whatsapp_outbox_recovery_failed")
  }

  // A follow-up claim is intentionally never resent after its outcome became uncertain. If a
  // process died after claiming it, convert it to the existing ambiguous + human-handoff path.
  try {
    const { error: followupRecoveryError } = await getServiceDb().rpc("recover_stale_whatsapp_followups")
    if (followupRecoveryError) console.error("whatsapp_followup_recovery_failed")
  } catch {
    console.error("whatsapp_followup_recovery_failed")
  }

  for (let index = 0; index < maxEvents; index += 1) {
    if (Date.now() - startedAt >= timeBudgetMs) break
    const event = await claimNextEvent(workerId)
    if (!event) break
    result.claimed += 1

    try {
      // The handler and the final queue ACK are deliberately separate durable steps. If the ACK
      // fails after this checkpoint, a later lease only retries the ACK and cannot reinterpret the
      // same patient message under the conversation's newly advanced state.
      if (!event.handler_completed_at) {
        await processClaimedWhatsAppEvent(event)
        await checkpointCompletedHandler(event.id, workerId)
      }
      await completeEvent(event.id, workerId)
      result.processed += 1
    } catch (error) {
      let handledError = error
      // Erasure can commit after the first check and surface as an unrelated missing-row/RPC
      // failure. Recheck before retry/DLQ so that already-erased work always takes the idempotent
      // completion path.
      if (!(handledError instanceof WhatsAppErasureSuppressedError)) {
        try {
          await assertEventNotErased(event)
        } catch (suppressionError) {
          if (suppressionError instanceof WhatsAppErasureSuppressedError) {
            handledError = suppressionError
          }
        }
      }
      if (handledError instanceof WhatsAppErasureSuppressedError) {
        // The erasure tombstone is already durable. Remove any still-claimed queue row without
        // running failure/DLQ logic that could recreate a technical lead.
        await completeErasedEvent(event, workerId)
        result.processed += 1
        continue
      }
      if (handledError instanceof WhatsAppAutomaticDispatchSuppressedError) {
        // A human takeover won the final CAS immediately before Meta. This is a successful,
        // intentional no-op for the inbound event: checkpoint and ACK it without retry/DLQ.
        try {
          await checkpointCompletedHandler(event.id, workerId)
          await completeEvent(event.id, workerId)
          result.processed += 1
        } catch (completionError) {
          const outcome = await failEvent(event, workerId, completionError)
          if (outcome === "dead_letter") result.deadLettered += 1
          else result.retried += 1
        }
        continue
      }
      if (handledError instanceof AmbiguousWhatsAppDeliveryError) {
        // This atomically pauses the bot and creates a technical handoff. If quarantine itself is
        // unavailable, keep the queue event retryable instead of losing the fail-closed transition.
        try {
          await quarantineAmbiguousOutbound(event, handledError)
        } catch (quarantineError) {
          const outcome = await failEvent(event, workerId, quarantineError)
          if (outcome === "dead_letter") result.deadLettered += 1
          else result.retried += 1
          continue
        }
      }
      const outcome = await failEvent(event, workerId, handledError)
      if (outcome === "dead_letter") result.deadLettered += 1
      else result.retried += 1
    }
  }

  return result
}
