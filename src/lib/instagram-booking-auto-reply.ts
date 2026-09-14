import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectionInfo, getProfile, getValidToken } from "@/lib/instagram-business"
import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import { containsSensitiveMedicalContent } from "@/lib/medical-safety"
import {
  classifyInstagramAdministrativeIntent,
  getInstagramAutoReplyBlockReason,
  type InstagramAdministrativeClassification,
} from "@/lib/instagram-admin-intent-classifier"
import {
  findPracticeSiteInText,
  getPracticeSitesForService,
  PRACTICE_SERVICE_NAMES,
  PRACTICE_SITES,
  type PracticeServiceId,
} from "@/lib/practice-directory"

const GRAPH_BASE = "https://graph.instagram.com/v26.0"
const FETCH_TIMEOUT_MS = 10_000
const MAX_REPLIES_PER_WEBHOOK = 20

export const INSTAGRAM_BOOKING_REPLY =
  "¡Hola! Soy el asistente virtual administrativo de la Dra. Lucía Chahin. Para pedir un turno, entrá al link de la bio y elegí dónde querés atenderte. Ahí vas a encontrar el canal oficial de cada institución. La disponibilidad, la prestación y la cobertura se confirman directamente con la sede al solicitarlo."

export const INSTAGRAM_COVERAGE_REPLY =
  "¡Hola! Gracias por consultar. Podés ver las obras sociales y prepagas con las que atiendo en las historias destacadas o en mi página web, desde el link de la bio. Como dependen de la sede y del plan, te recomiendo confirmar la cobertura directamente con la institución al pedir el turno. Saludos 😊"

export const INSTAGRAM_PAMI_REPLY =
  "¡Hola! Gracias por consultar. Por el momento no atiendo por PAMI. Podés ver las obras sociales y prepagas con las que atiendo en las historias destacadas o en mi página web, desde el link de la bio. Saludos 😊"

export const INSTAGRAM_APPOINTMENT_MANAGEMENT_REPLY =
  "¡Hola! Para cancelar, cambiar o confirmar un turno tenés que comunicarte directamente con la institución donde lo reservaste. En el link de la bio están los canales oficiales de cada sede."

export const INSTAGRAM_CONTACT_REPLY =
  "¡Hola! En el link de la bio vas a encontrar las direcciones, teléfonos y canales oficiales de cada lugar donde atiende la Dra. Lucía Chahin. Si me indicás la sede, puedo orientarte con el dato correspondiente."

export const INSTAGRAM_RESULTS_REPLY =
  "¡Hola! La entrega, disponibilidad o retiro de informes y resultados se gestiona directamente con la institución donde te realizaste el estudio. En el link de la bio están los canales oficiales de cada sede."

export const INSTAGRAM_REQUIREMENTS_REPLY =
  "¡Hola! Los requisitos administrativos para una consulta o estudio (por ejemplo orden, autorización o documentación) pueden variar según la institución y la cobertura. Te recomiendo confirmarlos directamente con la sede al pedir el turno; los canales oficiales están en el link de la bio."

export const INSTAGRAM_SPECIALTY_REPLY =
  "¡Hola! Sí, la Dra. Lucía Chahin es médica cardióloga. En el link de la bio podés ver los lugares donde atiende, horarios y canales oficiales para pedir turno."

const INSTAGRAM_LOCATION_LINES = PRACTICE_SITES.map(site =>
  `• ${site.name}${site.serviceNote ? ` (${site.serviceNote.toLowerCase()})` : ""}: ${site.hours}.`
).join("\n")

export const INSTAGRAM_LOCATION_REPLY =
  `¡Hola! Soy el asistente virtual administrativo de la Dra. Lucía Chahin. Estos son sus lugares y horarios habituales:\n${INSTAGRAM_LOCATION_LINES}\nEn el link de la bio podés ver las direcciones y los canales oficiales para pedir turno. La disponibilidad se confirma con cada institución.`

function serviceLabel(serviceId: PracticeServiceId): string {
  return PRACTICE_SERVICE_NAMES[serviceId].toLowerCase()
}

function sitesForService(serviceId: PracticeServiceId): string {
  return getPracticeSitesForService(serviceId).map(site => site.name).join(", ")
}

function serviceReply(text: string, requestedServices: PracticeServiceId[]): string | null {
  const site = findPracticeSiteInText(text)

  if (site) {
    const offered = site.services.map(serviceLabel)
    const offeredSummary = offered.length === 1 ? offered[0] : offered.join(" y ")
    const unavailableRequested = requestedServices.filter(serviceId => !site.services.includes(serviceId))

    if (unavailableRequested.length > 0) {
      const alternatives = unavailableRequested.map(serviceId => {
        const destination = sitesForService(serviceId)
        return `${serviceLabel(serviceId)}: ${destination}`
      }).join(" · ")
      return `¡Hola! En ${site.name} la Dra. Lucía Chahin realiza ${offeredSummary}. Para la otra prestación que consultás: ${alternatives}. En el link de la bio están los canales oficiales para pedir turno.`
    }

    return `¡Hola! En ${site.name} la Dra. Lucía Chahin realiza ${offeredSummary}. En el link de la bio están los canales oficiales de la sede para pedir turno y confirmar disponibilidad.`
  }

  if (requestedServices.includes("echocardiogram") && requestedServices.includes("cardiology_consultation")) {
    return `¡Hola! La Dra. Lucía Chahin realiza ecocardiogramas en ${sitesForService("echocardiogram")}. Para consulta cardiológica atiende en ${sitesForService("cardiology_consultation")}. En el link de la bio están los canales oficiales para pedir turno.`
  }
  if (requestedServices.includes("echocardiogram")) {
    return `¡Hola! La Dra. Lucía Chahin realiza ecocardiogramas en ${sitesForService("echocardiogram")}. En el link de la bio están los canales oficiales para pedir turno y confirmar disponibilidad.`
  }
  if (requestedServices.includes("cardiology_consultation")) {
    return `¡Hola! La Dra. Lucía Chahin realiza consulta cardiológica en ${sitesForService("cardiology_consultation")}. En el link de la bio están los canales oficiales para pedir turno y confirmar disponibilidad.`
  }
  return null
}

function locationReply(text: string): string {
  const site = findPracticeSiteInText(text)
  if (!site) return INSTAGRAM_LOCATION_REPLY
  return `¡Hola! ${site.name}: ${site.hours}. Dirección: ${site.address}. En el link de la bio están los canales oficiales para pedir turno y confirmar disponibilidad.`
}

function contactReply(text: string): string {
  const site = findPracticeSiteInText(text)
  if (!site) return INSTAGRAM_CONTACT_REPLY
  return `¡Hola! Para ${site.name}, el teléfono informado es ${site.phone}. En el link de la bio también tenés la dirección y los canales oficiales de la sede.`
}

export function getInstagramAutoReplyText(item: InstagramInboxItemInput): string | null {
  return getInstagramAutoReplyPlan(item)?.text ?? null
}

export type InstagramAutoReplyDelivery = "private_message" | "public_comment"

export interface InstagramAutoReplyPlan {
  text: string
  delivery: InstagramAutoReplyDelivery
}

function planFromClassification(
  item: InstagramInboxItemInput,
  classification: InstagramAdministrativeClassification
): InstagramAutoReplyPlan | null {
  const publicIfComment: InstagramAutoReplyDelivery = item.item_type === "comment"
    ? "public_comment"
    : "private_message"

  switch (classification.intent) {
    case "pami":
      return { text: INSTAGRAM_PAMI_REPLY, delivery: publicIfComment }
    case "coverage":
      return { text: INSTAGRAM_COVERAGE_REPLY, delivery: publicIfComment }
    case "appointment_management":
      return { text: INSTAGRAM_APPOINTMENT_MANAGEMENT_REPLY, delivery: "private_message" }
    case "results":
      return { text: INSTAGRAM_RESULTS_REPLY, delivery: "private_message" }
    case "requirements":
      return { text: INSTAGRAM_REQUIREMENTS_REPLY, delivery: "private_message" }
    case "contact":
      return { text: contactReply(item.content ?? ""), delivery: "private_message" }
    case "specialty":
      return { text: INSTAGRAM_SPECIALTY_REPLY, delivery: publicIfComment }
    case "service": {
      const reply = serviceReply(item.content ?? "", classification.services)
      return reply ? { text: reply, delivery: publicIfComment } : null
    }
    case "location":
      return { text: locationReply(item.content ?? ""), delivery: "private_message" }
    case "booking":
      return { text: INSTAGRAM_BOOKING_REPLY, delivery: "private_message" }
    default:
      return null
  }
}

export function getInstagramAutoReplyPlan(item: InstagramInboxItemInput): InstagramAutoReplyPlan | null {
  if (
    item.direction !== "inbound" ||
    !item.participant_id ||
    !item.content ||
    item.attachment_type
  ) return null

  if (item.content.trim().toLowerCase() === "[mensaje eliminado]") return null
  if (containsSensitiveMedicalContent(item.content)) return null
  if (getInstagramAutoReplyBlockReason(item.content)) return null

  const classification = classifyInstagramAdministrativeIntent(item.content)
  if (!classification) return null
  return planFromClassification(item, classification)
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
