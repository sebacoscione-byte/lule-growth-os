import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectionInfo, getValidToken } from "@/lib/instagram-business"
import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import { containsSensitiveMedicalContent } from "@/lib/medical-safety"

const GRAPH_BASE = "https://graph.instagram.com/v26.0"
const FETCH_TIMEOUT_MS = 10_000
const MAX_REPLIES_PER_WEBHOOK = 20

export const INSTAGRAM_BOOKING_REPLY =
  "¡Hola! Para pedir turno, ingresá al link de la bio y elegí la sede que te quede más cómoda. Allí vas a encontrar los enlaces para comunicarte por WhatsApp o por teléfono. Los turnos y la disponibilidad los confirma cada institución."

const BOOKING_INTENT_PATTERN =
  /\b(?:pedir|sacar|solicitar|reservar|agendar|conseguir|necesito|quiero|quisiera|busco|como (?:puedo|hago para))\b.{0,45}\b(?:un )?(?:turnos?|citas?)\b|\b(?:turnos?|citas?)\b.{0,45}\b(?:pedir|sacar|solicitar|reservar|agendar|conseguir|necesito|quiero|quisiera|disponibles?|disponibilidad)\b/
const WRONG_FLOW_PATTERN =
  /\b(?:cancelar|cambiar|reprogramar|confirmar|anular|perdi|perder|ya (?:saque|tengo)|no (?:quiero|necesito))\b.{0,35}\b(?:turno|cita)\b|\b(?:turno|cita)\b.{0,35}\b(?:cancelar|cambiar|reprogramar|confirmar|anular|perdi|perder)\b/
const OTHER_ADMIN_INTENT_PATTERN =
  /\b(?:precio|valor|costo|cuanto (?:sale|cuesta|cobra)|obra social|prepaga|cobertura|atiende por|acepta)\b/
const URGENCY_PATTERN = /\b(?:urgente|urgencia|emergencia|guardia)\b/

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function isEligibleInstagramBookingInquiry(item: InstagramInboxItemInput): boolean {
  if (
    item.direction !== "inbound" ||
    !item.participant_id ||
    !item.content ||
    item.attachment_type
  ) return false

  const text = normalizeText(item.content)
  if (!text || text === "[mensaje eliminado]") return false
  if (containsSensitiveMedicalContent(item.content)) return false
  if (URGENCY_PATTERN.test(text) || WRONG_FLOW_PATTERN.test(text) || OTHER_ADMIN_INTENT_PATTERN.test(text)) {
    return false
  }
  return BOOKING_INTENT_PATTERN.test(text)
}

interface SendResult {
  messageId: string | null
}

class InstagramSendError extends Error {
  constructor(
    public readonly safeCode: string,
    public readonly outcome: "definite_failure" | "indeterminate"
  ) {
    super(safeCode)
    this.name = "InstagramSendError"
  }
}

function sourceTargetId(item: InstagramInboxItemInput): string {
  const prefix = `${item.item_type}:`
  return item.external_id.startsWith(prefix) ? item.external_id.slice(prefix.length) : item.external_id
}

async function sendInstagramBookingReply(
  token: string,
  item: InstagramInboxItemInput
): Promise<SendResult> {
  const recipient = item.item_type === "comment"
    ? { comment_id: sourceTargetId(item) }
    : { id: item.participant_id! }
  const body = { recipient, message: { text: INSTAGRAM_BOOKING_REPLY } }

  let response: Response
  try {
    response = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(item.instagram_account_id)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    )
  } catch {
    // Un timeout o corte puede ocurrir después de que Meta haya aceptado el mensaje. No se reintenta.
    throw new InstagramSendError("network_indeterminate", "indeterminate")
  }

  let payload: { message_id?: unknown; error?: { code?: unknown; error_subcode?: unknown } } = {}
  try {
    payload = await response.json() as typeof payload
  } catch {
    if (response.ok) throw new InstagramSendError("invalid_success_response", "indeterminate")
  }
  if (!response.ok || payload.error) {
    const metaCode = typeof payload.error?.code === "number" ? payload.error.code : null
    const subcode = typeof payload.error?.error_subcode === "number" ? payload.error.error_subcode : null
    const suffix = [metaCode, subcode].filter(value => value !== null).join("_")
    throw new InstagramSendError(
      `meta_${response.status}${suffix ? `_${suffix}` : ""}`.slice(0, 80),
      "definite_failure"
    )
  }
  return { messageId: typeof payload.message_id === "string" ? payload.message_id : null }
}

export interface InstagramAutoReplyResult {
  eligible: number
  sent: number
  skipped: number
  failed: number
  indeterminate: number
}

async function markReply(
  supabase: SupabaseClient,
  id: string,
  values: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("instagram_auto_replies")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "processing")
  if (error) throw new Error("instagram_auto_reply_status_failed")
}

/**
 * Envía únicamente la plantilla administrativa aprobada. Un claim transaccional en PostgreSQL
 * deduplica reintentos de Meta y aplica el límite de una respuesta por persona cada 24 horas.
 */
export async function processInstagramBookingAutoReplies(
  supabase: SupabaseClient,
  items: InstagramInboxItemInput[]
): Promise<InstagramAutoReplyResult> {
  const eligibleItems = items.filter(isEligibleInstagramBookingInquiry)
  const candidates = eligibleItems.slice(0, MAX_REPLIES_PER_WEBHOOK)
  const result: InstagramAutoReplyResult = {
    eligible: candidates.length,
    sent: 0,
    skipped: eligibleItems.length - candidates.length,
    failed: 0,
    indeterminate: 0,
  }
  if (candidates.length === 0) return result

  const { data: settings, error: settingsError } = await supabase
    .from("instagram_auto_reply_settings")
    .select("enabled")
    .eq("id", true)
    .maybeSingle()
  if (settingsError || settings?.enabled !== true) {
    result.skipped += candidates.length
    return result
  }

  let token: string | null
  let connection: Awaited<ReturnType<typeof getConnectionInfo>>
  try {
    ;[token, connection] = await Promise.all([
      getValidToken(supabase),
      getConnectionInfo(supabase),
    ])
  } catch {
    result.failed += candidates.length
    return result
  }
  if (!token || !connection?.instagram_user_id) {
    result.failed += candidates.length
    return result
  }

  await Promise.all(candidates.map(async item => {
    if (item.instagram_account_id !== connection.instagram_user_id) {
      result.skipped += 1
      return
    }
    const { data: claimId, error: claimError } = await supabase.rpc(
      "claim_instagram_booking_auto_reply",
      {
        p_source_external_id: item.external_id,
        p_instagram_account_id: item.instagram_account_id,
        p_participant_id: item.participant_id,
        p_source_type: item.item_type,
        p_target_id: sourceTargetId(item),
        p_reply_text: INSTAGRAM_BOOKING_REPLY,
      }
    )
    if (claimError) {
      result.failed += 1
      return
    }
    if (typeof claimId !== "string" || !claimId) {
      result.skipped += 1
      return
    }

    try {
      const sent = await sendInstagramBookingReply(token, item)
      await markReply(supabase, claimId, {
        status: "sent",
        meta_message_id: sent.messageId,
        sent_at: new Date().toISOString(),
        error_code: null,
      })
      result.sent += 1
    } catch (error) {
      const sendError = error instanceof InstagramSendError
        ? error
        : new InstagramSendError("local_indeterminate", "indeterminate")
      try {
        await markReply(supabase, claimId, {
          status: sendError.outcome === "indeterminate" ? "indeterminate" : "failed",
          error_code: sendError.safeCode,
        })
      } catch {
        // La fila sigue en processing, que también bloquea reintentos y evita duplicados.
      }
      if (sendError.outcome === "indeterminate") result.indeterminate += 1
      else result.failed += 1
    }
  }))
  return result
}
