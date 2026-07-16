import { createHash, randomUUID } from "node:crypto"
import { getServiceDb } from "@/lib/supabase/service"
import { WhatsAppErasureSuppressedError } from "@/lib/whatsapp-erasure-suppression"

export type WhatsAppDispatchFailureDisposition = "suppressed" | "rejected" | "ambiguous"

export class AmbiguousWhatsAppDeliveryError extends Error {
  constructor(
    public readonly ledgerKey: string,
    public readonly code: "delivery_ambiguous" | "delivery_in_flight" | "ledger_finalize_failed" | "provider_response_without_message_id"
  ) {
    super(code)
    this.name = "AmbiguousWhatsAppDeliveryError"
  }
}

export class RejectedWhatsAppDeliveryError extends Error {
  constructor(public readonly ledgerKey: string) {
    super("delivery_rejected")
    this.name = "RejectedWhatsAppDeliveryError"
  }
}

export interface OutboundLedgerIdentity {
  sourceKey: string | null | undefined
  destination: string
  flowStep: string | null | undefined
  messageType: string
  payload: object
}

interface ExecuteOutboundOptions<T> extends OutboundLedgerIdentity {
  dispatch: () => Promise<T>
  extractWaMessageId: (result: T) => string | null
  classifyFailure: (error: unknown) => WhatsAppDispatchFailureDisposition
}

export interface OutboundDispatchResult<T> {
  result: T
  ledgerKey: string | null
  replayedAccepted: boolean
}

interface ClaimRow {
  outcome: "dispatch" | "accepted" | "ambiguous" | "in_flight" | "rejected" | "suppressed"
  wa_message_id: string | null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

export function buildWhatsAppOutboundLedgerIdentity(identity: OutboundLedgerIdentity): {
  dedupeKey: string
  sourceHash: string
  destinationHash: string
  payloadHash: string
} | null {
  const sourceKey = identity.sourceKey?.trim()
  const flowStep = identity.flowStep?.trim()
  if (!sourceKey || !flowStep) return null

  const sourceHash = sha256(sourceKey)
  const destinationHash = sha256(identity.destination)
  return {
    // The content hash is deliberately not part of the key. A retry after a copy/config change
    // must conflict and stop, not create a second outbound intent for the same flow step.
    dedupeKey: sha256(`wa-outbound-v1|${sourceHash}|${flowStep}|${identity.messageType}`),
    sourceHash,
    destinationHash,
    payloadHash: sha256(canonicalize(identity.payload)),
  }
}

async function claimOutboundIntent(
  identity: ReturnType<typeof buildWhatsAppOutboundLedgerIdentity> & object,
  flowStep: string,
  messageType: string,
  workerId: string
): Promise<ClaimRow> {
  const { data, error } = await getServiceDb().rpc("claim_whatsapp_outbound_intent", {
    p_dedupe_key: identity.dedupeKey,
    p_source_event_hash: identity.sourceHash,
    p_destination_hash: identity.destinationHash,
    p_flow_step: flowStep,
    p_message_type: messageType,
    p_payload_hash: identity.payloadHash,
    p_worker_id: workerId,
  })
  if (error) throw new Error("outbound_ledger_claim_failed")
  const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | null
  if (!row?.outcome) throw new Error("outbound_ledger_claim_failed")
  return row
}

async function finalizeOutboundIntent(
  ledgerKey: string,
  workerId: string,
  outcome: "accepted" | "ambiguous" | "rejected",
  waMessageId: string | null,
  errorCode: string | null
): Promise<boolean> {
  const { data, error } = await getServiceDb().rpc("finalize_whatsapp_outbound_intent", {
    p_dedupe_key: ledgerKey,
    p_worker_id: workerId,
    p_outcome: outcome,
    p_wa_message_id: waMessageId,
    p_error_code: errorCode,
  })
  return !error && data === true
}

/**
 * Provides durable at-most-once dispatch attempts for a stable source+flow step. It cannot prove
 * exactly-once delivery at Meta: a connection can fail after Meta accepted the request but before
 * its response reaches us. That case is intentionally frozen as ambiguous and never resent.
 */
export async function executeWhatsAppOutboundWithLedger<T>(options: ExecuteOutboundOptions<T>): Promise<OutboundDispatchResult<T>> {
  const identity = buildWhatsAppOutboundLedgerIdentity(options)
  if (!identity) {
    throw new Error("outbound_ledger_identity_required")
  }

  const flowStep = options.flowStep!.trim().slice(0, 120)
  const messageType = options.messageType.slice(0, 80)
  const workerId = randomUUID()
  const claim = await claimOutboundIntent(identity, flowStep, messageType, workerId)

  if (claim.outcome === "accepted" && claim.wa_message_id) {
    return {
      result: { messages: [{ id: claim.wa_message_id }] } as T,
      ledgerKey: identity.dedupeKey,
      replayedAccepted: true,
    }
  }
  if (claim.outcome === "rejected") throw new RejectedWhatsAppDeliveryError(identity.dedupeKey)
  if (claim.outcome === "suppressed") throw new WhatsAppErasureSuppressedError()
  if (claim.outcome === "in_flight") {
    throw new AmbiguousWhatsAppDeliveryError(identity.dedupeKey, "delivery_in_flight")
  }
  if (claim.outcome === "ambiguous") {
    throw new AmbiguousWhatsAppDeliveryError(identity.dedupeKey, "delivery_ambiguous")
  }
  if (claim.outcome !== "dispatch") throw new Error("outbound_ledger_claim_failed")

  let result: T
  try {
    result = await options.dispatch()
  } catch (error) {
    const disposition = options.classifyFailure(error)
    if (error instanceof WhatsAppErasureSuppressedError || disposition === "suppressed") {
      // Human takeover and erasure happen before the provider call. Mark a surviving intent as
      // rejected when possible, but preserve the intentional suppression if erasure already
      // removed the ledger row.
      await finalizeOutboundIntent(
        identity.dedupeKey,
        workerId,
        "rejected",
        null,
        "dispatch_suppressed"
      ).catch(() => false)
      throw error
    }
    const finalized = await finalizeOutboundIntent(
      identity.dedupeKey,
      workerId,
      disposition,
      null,
      disposition === "rejected" ? "provider_rejected" : "provider_result_unknown"
    )
    if (disposition === "rejected" && finalized) throw error
    throw new AmbiguousWhatsAppDeliveryError(
      identity.dedupeKey,
      finalized ? "delivery_ambiguous" : "ledger_finalize_failed"
    )
  }

  const waMessageId = options.extractWaMessageId(result)
  if (!waMessageId) {
    await finalizeOutboundIntent(identity.dedupeKey, workerId, "ambiguous", null, "missing_provider_message_id")
    throw new AmbiguousWhatsAppDeliveryError(identity.dedupeKey, "provider_response_without_message_id")
  }

  const finalized = await finalizeOutboundIntent(identity.dedupeKey, workerId, "accepted", waMessageId, null)
  if (!finalized) {
    // A best-effort second write can make the manual state explicit. If the database is still
    // unavailable, the dispatching row is treated as ambiguous when its lease is inspected later.
    await finalizeOutboundIntent(identity.dedupeKey, workerId, "ambiguous", waMessageId, "acceptance_persist_failed")
      .catch(() => false)
    throw new AmbiguousWhatsAppDeliveryError(identity.dedupeKey, "ledger_finalize_failed")
  }

  return { result, ledgerKey: identity.dedupeKey, replayedAccepted: false }
}
