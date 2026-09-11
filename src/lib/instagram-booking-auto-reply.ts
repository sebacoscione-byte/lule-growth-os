import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectionInfo, getProfile, getValidToken } from "@/lib/instagram-business"
import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import { containsSensitiveMedicalContent } from "@/lib/medical-safety"
import { PRACTICE_SITES } from "@/lib/practice-directory"

const GRAPH_BASE = "https://graph.instagram.com/v26.0"
const FETCH_TIMEOUT_MS = 10_000
const MAX_REPLIES_PER_WEBHOOK = 20

export const INSTAGRAM_BOOKING_REPLY =
  "¡Hola! Soy el asistente virtual administrativo de la Dra. Lucía Chahin. Para pedir un turno, entrá al link de la bio y elegí dónde querés atenderte. Ahí vas a encontrar el canal oficial de cada institución. La disponibilidad, la prestación y la cobertura se confirman directamente con la sede al solicitarlo."

export const INSTAGRAM_COVERAGE_REPLY =
  "¡Hola! Gracias por consultar. Podés ver las obras sociales y prepagas con las que atiendo en las historias destacadas o en mi página web, desde el link de la bio. Como dependen de la sede y del plan, te recomiendo confirmar la cobertura directamente con la institución al pedir el turno. Saludos 😊"

export const INSTAGRAM_PAMI_REPLY =
  "¡Hola! Gracias por consultar. Por el momento no atiendo por PAMI. Podés ver las obras sociales y prepagas con las que atiendo en las historias destacadas o en mi página web, desde el link de la bio. Saludos 😊"

const INSTAGRAM_LOCATION_LINES = PRACTICE_SITES.map(site =>
  `• ${site.name}${site.serviceNote ? ` (${site.serviceNote.toLowerCase()})` : ""}: ${site.hours}.`
).join("\n")

export const INSTAGRAM_LOCATION_REPLY =
  `¡Hola! Soy el asistente virtual administrativo de la Dra. Lucía Chahin. Estos son sus lugares y horarios habituales:\n${INSTAGRAM_LOCATION_LINES}\nEn el link de la bio podés ver las direcciones y los canales oficiales para pedir turno. La disponibilidad se confirma con cada institución.`

const BOOKING_INTENT_PATTERN =
  /\b(?:pedir|sacar|solicitar|reservar|agendar|conseguir|necesito|quiero|quisiera|busco|como (?:puedo|hago para)|hay|tenes|tienen|dan)\b.{0,45}\b(?:un )?(?:turnos?|citas?)\b|\b(?:turnos?|citas?)\b.{0,45}\b(?:pedir|sacar|solicitar|reservar|agendar|conseguir|necesito|quiero|quisiera|disponibles?|disponibilidad|hay|tenes|tienen)\b/
const SHORT_BOOKING_INTENT_PATTERN =
  /^[¿?¡! ]*(?:hola[,.! ]*)?(?:turnos?|citas?)[¿?.! ]*$/
const WRONG_FLOW_PATTERN =
  /\b(?:cancelar|cambiar|reprogramar|confirmar|anular|perdi|perder|ya (?:saque|tengo)|no (?:quiero|necesito))\b.{0,35}\b(?:turno|cita)\b|\b(?:turno|cita)\b.{0,35}\b(?:cancelar|cambiar|reprogramar|confirmar|anular|perdi|perder)\b/
const COVERAGE_INTENT_PATTERN =
  /\b(?:obras? sociales?|prepagas?|coberturas?|pami|sin (?:obra social|prepaga)|no tengo (?:obra social|prepaga)|(?:atienden?|atendes) (?:por|con|x)|aceptan? (?:la |el )?(?:obra social|prepaga|plan)|trabajan? con)\b|\b(?:atenderme|atencion|consulta|turno|atienden?|atendes)\b.{0,30}\bparticular\b|\bparticular\b.{0,30}\b(?:atenderme|atencion|consulta|turno|atienden?|atendes)\b/
const LOCATION_CONTEXT_PATTERN =
  /\b(?:atiende|atendes|atencion|consultorio|doctora|dra|cardiologa|cimel|hospital britanico|britanico|swiss medical|swiss|sede)\b/
const LOCATION_QUESTION_PATTERN =
  /\b(?:donde|como llegar|en que (?:sede|lugar|zona)|cuales? (?:sedes?|lugares?)|sedes?|lugares?|ubicacion|direccion|horarios?|que dias?|que dia|cuando|(?:atiende(?:s)?|atendes) (?:en|(?:el|los?) (?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)))\b/
const PRICE_INTENT_PATTERN =
  /\b(?:precio|valor|costo|cuanto (?:sale|cuesta|cobra))\b/
const URGENCY_PATTERN = /\b(?:urgente|urgencia|emergencia|guardia)\b/

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function getInstagramAutoReplyText(item: InstagramInboxItemInput): string | null {
  return getInstagramAutoReplyPlan(item)?.text ?? null
}

export type InstagramAutoReplyDelivery = "private_message" | "public_comment"

export interface InstagramAutoReplyPlan {
  text: string
  delivery: InstagramAutoReplyDelivery
}

export function getInstagramAutoReplyPlan(item: InstagramInboxItemInput): InstagramAutoReplyPlan | null {
  if (
    item.direction !== "inbound" ||
    !item.participant_id ||
    !item.content ||
    item.attachment_type
  ) return null

  const text = normalizeText(item.content)
  if (!text || text === "[mensaje eliminado]") return null
  if (containsSensitiveMedicalContent(item.content)) return null
  if (URGENCY_PATTERN.test(text) || WRONG_FLOW_PATTERN.test(text) || PRICE_INTENT_PATTERN.test(text)) {
    return null
  }
  const coverageDelivery: InstagramAutoReplyDelivery = item.item_type === "comment"
    ? "public_comment"
    : "private_message"
  if (/\bpami\b/.test(text)) return { text: INSTAGRAM_PAMI_REPLY, delivery: coverageDelivery }
  if (COVERAGE_INTENT_PATTERN.test(text)) {
    return { text: INSTAGRAM_COVERAGE_REPLY, delivery: coverageDelivery }
  }
  if (LOCATION_CONTEXT_PATTERN.test(text) && LOCATION_QUESTION_PATTERN.test(text)) {
    return { text: INSTAGRAM_LOCATION_REPLY, delivery: "private_message" }
  }
  if (BOOKING_INTENT_PATTERN.test(text) || SHORT_BOOKING_INTENT_PATTERN.test(text)) {
    return { text: INSTAGRAM_BOOKING_REPLY, delivery: "private_message" }
  }
  return null
}

export function isEligibleInstagramBookingInquiry(item: InstagramInboxItemInput): boolean {
  return getInstagramAutoReplyText(item) !== null
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
  senderAccountId: string,
  item: InstagramInboxItemInput,
  reply: InstagramAutoReplyPlan
): Promise<SendResult> {
  const publicComment = reply.delivery === "public_comment"
  const targetId = sourceTargetId(item)
  const url = publicComment
    ? `${GRAPH_BASE}/${encodeURIComponent(targetId)}/replies`
    : `${GRAPH_BASE}/${encodeURIComponent(senderAccountId)}/messages`
  const body = publicComment
    ? { message: reply.text }
    : {
        recipient: item.item_type === "comment" ? { comment_id: targetId } : { id: item.participant_id! },
        message: { text: reply.text },
      }

  let response: Response
  try {
    response = await fetch(
      url,
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

  let payload: { id?: unknown; message_id?: unknown; error?: { code?: unknown; error_subcode?: unknown } } = {}
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
  const resultId = publicComment ? payload.id : payload.message_id
  return { messageId: typeof resultId === "string" ? resultId : null }
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
 * Envía únicamente una de las plantillas administrativas aprobadas. Un claim transaccional en
 * PostgreSQL deduplica reintentos de Meta y evita repetir el mismo texto durante 15 minutos.
 */
export async function processInstagramBookingAutoReplies(
  supabase: SupabaseClient,
  items: InstagramInboxItemInput[]
): Promise<InstagramAutoReplyResult> {
  const eligibleItems = items.flatMap(item => {
    const reply = getInstagramAutoReplyPlan(item)
    return reply ? [{ item, reply }] : []
  })
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

  let profile: Awaited<ReturnType<typeof getProfile>>
  try {
    profile = await getProfile(token)
  } catch {
    result.failed += candidates.length
    return result
  }
  if (!profile.id || profile.id !== connection.instagram_user_id) {
    result.failed += candidates.length
    return result
  }
  const acceptedWebhookAccountIds = new Set([profile.id, profile.user_id].filter(Boolean))

  await Promise.all(candidates.map(async candidate => {
    const { item, reply } = candidate
    // Meta usa `user_id` (ID público) en el webhook y `id` (ID scoped de la app) en /me y Send API.
    if (!acceptedWebhookAccountIds.has(item.instagram_account_id)) {
      result.skipped += 1
      return
    }
    const { data: claimId, error: claimError } = await supabase.rpc(
      "claim_instagram_booking_auto_reply",
      {
        p_source_external_id: item.external_id,
        p_instagram_account_id: profile.id,
        p_participant_id: item.participant_id,
        p_source_type: item.item_type,
        p_target_id: sourceTargetId(item),
        p_reply_text: reply.text,
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
      const sent = await sendInstagramBookingReply(token, profile.id, item, reply)
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
