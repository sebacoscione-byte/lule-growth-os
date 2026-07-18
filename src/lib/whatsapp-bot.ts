import { getServiceDb } from "@/lib/supabase/service"
import { sendText, sendButtons, sendList, type SendContext } from "@/lib/whatsapp"
import { getWindowState, detectEntryPoint, type WhatsAppReferral } from "@/lib/whatsapp-window"
import { extractIntake, classifyIntent, classifyProtocolButtonReply, isMarketingOptOutMessage, INTENT_REPLIES, type IntakeExtraction } from "@/lib/whatsapp-intents"
import { extractReferralCode, findReferralCodeInfo } from "@/lib/landing-referral-codes"
import {
  containsSensitiveMedicalContent,
  isEmergencyMessage,
  isMedicalBoundaryMessage,
  EMERGENCY_REPLY,
  MEDICAL_BOUNDARY_REPLY,
  SENSITIVE_MEDICAL_CONTENT_REPLY,
} from "@/lib/medical-safety"
import {
  CONSENT_TEXT,
  CONSENT_ACCEPT_BUTTON_ID,
  CONSENT_DECLINE_BUTTON_ID,
  interpretConsentReply,
  recordConsent,
  hasConsented,
  FOLLOWUP_CONSENT_TEXT,
  FOLLOWUP_ACCEPT_BUTTON_ID,
  FOLLOWUP_DECLINE_BUTTON_ID,
  recordAppointmentFollowupConsent,
  recordResearchProtocolConsent,
} from "@/lib/whatsapp-consent"
import { buildHandoffSummary, escalateToHuman, type HandoffLeadInfo } from "@/lib/whatsapp-handoff"
import { logWhatsAppMessage } from "@/lib/whatsapp-cost-tracking"
import { getWhatsAppSettings, isHighValueLead, shouldForceHandoff } from "@/lib/whatsapp-settings"
import { evaluateWhatsAppPolicyShadow } from "@/lib/whatsapp-policy-shadow-runner"
import {
  getOperationalWhatsAppLocations,
  type WhatsAppLocationConfig,
  type WhatsAppLocationId,
} from "@/lib/whatsapp-location-config"
import type { HandoffReason, Lead, WhatsAppEntryPoint } from "@/types"

export type BotState =
  | "nuevo"
  | "esperando_consentimiento"
  | "intake_pendiente"
  | "esperando_obra_social"
  | "esperando_sede"
  | "esperando_seguimiento"
  | "derivado"
  | "handoff_pending"
  | "human_active"
  | "closed"
export type WhatsAppInboundMessageType =
  | "text"
  | "button_reply"
  | "list_reply"
  | "audio"
  | "image"
  | "document"
  | "sticker"
  | "video"
  | "location"
  | "contacts"
  | "unknown"
type MessageType = WhatsAppInboundMessageType
type Sede = WhatsAppLocationId

interface WhatsAppSession {
  id: string
  phone: string
  wa_name: string | null
  state: BotState
  obra_social: string | null
  lead_id: string | null
  last_inbound_at: string | null
  entry_point: WhatsAppEntryPoint | null
  ctwa_clid: string | null
  messages_sent_count: number
  /** GROWTH-01: código detectado en el primer mensaje (ej. "LAN-CARD-01") — se aplica al lead
   * recién cuando se crea, en upsertLeadFromIntake. */
  referral_code: string | null
  /** El equipo tomó la conversación a mano desde el Inbox — el bot deja de responder hasta que
   * alguien lo reactive (ver /api/whatsapp/bot-pause). No afecta guardrails de emergencia/opt-out,
   * que se chequean antes de este flag. */
  bot_paused: boolean
  /** Incremented by every manual handoff/takeover transition. */
  state_version: number
  updated_at?: string
}

function getDb() {
  return getServiceDb()
}

async function getOrCreateSession(phone: string): Promise<WhatsAppSession> {
  const db = getDb()
  const { data: existing } = await db.from("whatsapp_sessions").select("*").eq("phone", phone).single()
  if (existing) return existing as WhatsAppSession

  const { data: created, error } = await db
    .from("whatsapp_sessions")
    .insert({ phone, state: "nuevo" })
    .select()
    .single()

  if (error) throw new Error(`Error creando sesión: ${error.message}`)
  return created as WhatsAppSession
}

async function updateSession(phone: string, updates: Partial<WhatsAppSession>) {
  const db = getDb()
  const { error } = await db
    .from("whatsapp_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("phone", phone)
  if (error) throw new Error("whatsapp_session_update_failed")
}

async function getLocations(): Promise<WhatsAppLocationConfig[]> {
  try {
    const db = getDb()
    const { data, error } = await db.from("app_config").select("value").eq("key", "locations").single()
    if (error) return []
    return getOperationalWhatsAppLocations(data?.value)
  } catch {
    return []
  }
}

async function getLead(leadId: string): Promise<Lead | null> {
  const db = getDb()
  const { data, error } = await db.from("leads").select("*").eq("id", leadId).maybeSingle()
  if (error) throw new Error("whatsapp_lead_read_failed")
  return (data as Lead | null) ?? null
}

/** Para respuestas a botones de templates enviados a numeros sin lead previo (ej. una invitacion a protocolo enviada en frio). */
async function ensureLeadId(
  session: WhatsAppSession,
  phone: string,
  sourceWaMessageId?: string
): Promise<string> {
  if (session.lead_id) return session.lead_id

  const { data, error } = await getDb().rpc("ensure_whatsapp_lead", {
    p_phone: phone,
    p_name: session.wa_name ?? null,
    p_status: "interesado",
    p_possible_emergency: false,
    p_requires_human: false,
    p_source_wa_message_id: sourceWaMessageId ?? null,
  })
  if (error || typeof data !== "string") throw new Error("whatsapp_lead_ensure_failed")
  return data
}

function leadPreferredSede(lead: Lead | null): Sede | null {
  const loc = lead?.preferred_location
  return loc === "cimel_lanus" || loc === "swiss_lomas" || loc === "hospital_britanico" ? loc : null
}

function toHandoffLead(lead: Lead | null): HandoffLeadInfo | null {
  if (!lead) return null
  return {
    id: lead.id,
    name: lead.name,
    insurance: lead.insurance,
    patient_age: lead.patient_age,
    general_reason: lead.general_reason,
    possible_emergency: lead.possible_emergency,
    protocol_interest: lead.protocol_interest,
    protocol_name: lead.protocol_name,
    last_message: lead.last_message,
  }
}

const REQUESTED_SERVICE_BY_MOTIVO: Record<NonNullable<IntakeExtraction["motivo"]>, Lead["requested_service"]> = {
  turno: "consulta_cardiologia",
  estudio: "ecocardiograma",
  protocolo: "no_definido",
}

const GENERAL_REASON_BY_MOTIVO: Record<NonNullable<IntakeExtraction["motivo"]>, string> = {
  turno: "consulta_cardiologica",
  estudio: "estudio_cardiologico",
  protocolo: "protocolo_investigacion",
}

/** Persiste el intake administrativo en una sola transacción idempotente. */
async function upsertLeadFromIntake(
  session: WhatsAppSession,
  waName: string | undefined,
  extraction: IntakeExtraction,
  rawMessage: string,
  waMessageId: string | undefined,
  administrativeConsentGranted: boolean
): Promise<string> {
  if (!administrativeConsentGranted) {
    throw new Error("No se puede registrar el intake sin consentimiento administrativo explícito.")
  }

  // GROWTH-01: si el primer mensaje traía un código de referencia real (ver
  // landing-referral-codes.ts), atribuye el lead a la landing/sede exacta que lo generó. Si el
  // paciente borró o nunca tuvo un código (mensaje orgánico), utm_content/landing_page quedan
  // null -- el embudo del dashboard los muestra como "sin atribuir", no hace falta un valor
  // literal "unknown".
  const referralInfo = session.referral_code ? findReferralCodeInfo(session.referral_code) : null
  const { data, error } = await getDb().rpc("upsert_whatsapp_intake_lead", {
    p_phone: session.phone,
    p_name: waName ?? session.wa_name ?? null,
    p_requested_service: extraction.motivo ? REQUESTED_SERVICE_BY_MOTIVO[extraction.motivo] : null,
    p_general_reason: extraction.motivo ? GENERAL_REASON_BY_MOTIVO[extraction.motivo] : null,
    p_insurance: extraction.obraSocial ?? null,
    p_utm_content: referralInfo?.code ?? null,
    p_landing_page: referralInfo?.landingSlug ?? null,
    p_raw_message: rawMessage.trim() || null,
    p_wa_message_id: waMessageId ?? null,
  })
  if (error || typeof data !== "string") throw new Error("whatsapp_intake_transaction_failed")
  return data
}

const STATUS_BY_SEDE: Record<Sede, Lead["status"]> = {
  cimel_lanus: "derivado_cimel",
  swiss_lomas: "derivado_swiss",
  hospital_britanico: "derivado_britanico",
}

async function updateLeadLocation(leadId: string, preferredLocation: Sede) {
  const db = getDb()
  const { error } = await db
    .from("leads")
    .update({ preferred_location: preferredLocation, status: STATUS_BY_SEDE[preferredLocation] })
    .eq("id", leadId)
  if (error) throw new Error("whatsapp_lead_location_update_failed")
}

async function updateLeadInsurance(leadId: string, insurance: string) {
  const db = getDb()
  const { error } = await db.from("leads").update({ insurance }).eq("id", leadId)
  if (error) throw new Error("whatsapp_lead_insurance_update_failed")
}

function wantsToChangeObraSocial(text: string): boolean {
  const lower = text.toLowerCase()
  const mentionsCoverage = ["obra social", "cobertura", "prepaga"].some(k => lower.includes(k))
  const mentionsChange = ["cambi", "actualiz"].some(k => lower.includes(k))
  return mentionsCoverage && mentionsChange
}

// Incidente real 2026-07-15 (prueba de Sebastián): "Quiero atenderme particular" en una
// conversación ya en curso tampoco matcheaba ninguna regla (consultar_cobertura pide la palabra
// "cobertura"/"obra social"/"prepaga" literal) y terminaba ofreciendo escalar a humano. "Particular"
// solo es ambigua en español ("una duda particular" = específica, no self-pay) -- por eso el patrón
// exige que esté pegada a un verbo de atención ("atenderme particular", "soy particular", "vengo
// particular"), no la palabra suelta en cualquier parte de la frase.
const DECLARES_NO_COVERAGE_PATTERN =
  /\b(soy|vengo|atenderme|atiendo|ir[ée]?)\s+particular\b|\bparticular\s+nom[áa]s\b|sin\s+cobertura|no\s+tengo\s+(obra\s+social|cobertura|prepaga)/i

// Incidente real 2026-07-15 (prueba de Sebastián): un "Hola" simple de alguien que ya tiene una
// conversación en curso (estado "derivado") no matchea ninguna regla ni categoría concreta, así
// que terminaba clasificado como "otro_no_entendido" -- respuesta correcta desde el clasificador,
// pero esa rama manda "no entendí tu consulta" + botón de escalar a humano, como si el bot hubiera
// fallado. Para un simple saludo de alguien que ya está en la conversación, corresponde la
// bienvenida de vuelta (ver bloque de "repetir menú" más abajo), no un aviso de fallo -- y es un
// chequeo determinístico, gratis, sin gastar una clasificación con IA.
const BARE_GREETING_PATTERN = /^\s*(hola+|holis+|buenas|buen[oa]s?\s+(d[ií]as?|tardes?|noches?)|hey|ey)\W*$/i

async function buildSedeInstructions(sede: Sede, intro: string): Promise<string | null> {
  const locations = await getLocations()
  const loc = locations.find(l => l.id === sede)
  if (!loc) return null

  const lines = [`${intro} Para sacar turno con la *Dra. Lucía Chahin* en *${loc.name}*:`]

  if (loc.address) lines.push(`🏥 Dirección: ${loc.address}`)
  if (loc.day) lines.push(`📅 Ella atiende los *${loc.day}*`)
  if (loc.hours) lines.push(`🕐 Horarios: ${loc.hours}`)
  if (loc.phone) lines.push(`📞 Turnos telefónicos: *${loc.phone}*`)

  if (loc.booking_url) lines.push(`🔗 Canal oficial para pedir turno: ${loc.booking_url}`)

  if (loc.booking_instruction) lines.push(loc.booking_instruction)
  lines.push("\n¡Ante cualquier duda, acá estamos! 😊")

  return lines.join("\n")
}

function normalizeCoverageName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:plan)?\s*\d+[a-z]?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function buildCoverageNotice(
  location: Pick<WhatsAppLocationConfig, "name" | "obras_sociales">,
  insurance: string | null | undefined
): string | null {
  const declared = insurance?.trim()
  if (!declared) return null

  const normalizedDeclared = normalizeCoverageName(declared)
  const isParticular = normalizedDeclared === "particular"
    || normalizedDeclared === "particular sin cobertura"
    || normalizedDeclared === "sin cobertura"
  const listed = location.obras_sociales.some(item => {
    const normalizedItem = normalizeCoverageName(item)
    return normalizedItem === normalizedDeclared
      || (normalizedItem.length >= 4 && normalizedDeclared.startsWith(`${normalizedItem} `))
  })

  if (listed || (isParticular && location.obras_sociales.some(item => normalizeCoverageName(item) === "particular"))) {
    return `La cobertura *${declared}* figura en la lista verificada de *${location.name}*.`
  }
  return `La cobertura *${declared}* no figura en la lista verificada de *${location.name}*. Confirmala directamente con la sede antes de pedir el turno o consultá por atención particular.`
}

// Ola 4 (P1, incidente real 2026-07-14): mientras se espera que una persona del equipo responda,
// dar de una un contacto directo de la sede que el paciente ya eligió -- antes el mensaje de
// derivación no tenía ningún dato de contacto propio.
function buildHumanFallbackLine(loc: WhatsAppLocationConfig | undefined): string {
  if (loc?.booking_url) {
    return `\n\nMientras tanto, podés usar el canal oficial de *${loc.name}*: ${loc.booking_url}`
  }
  return loc?.phone
    ? `\n\nMientras tanto, podés llamar directo a *${loc.name}*: ${loc.phone}`
    : ""
}

async function buildHablarConHumanoReply(lead: Lead | null): Promise<string> {
  const base = INTENT_REPLIES.hablar_con_humano!
  const sede = leadPreferredSede(lead)
  if (!sede) return base

  const locations = await getLocations()
  return base + buildHumanFallbackLine(locations.find(l => l.id === sede))
}

function normalizeLocationText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
}

function parseSede(
  text: string,
  locations: WhatsAppLocationConfig[],
  buttonId?: string
): Sede | null {
  const buttonLocation = locations.find(location => location.id === buttonId)
  if (buttonLocation) return buttonLocation.id

  const normalizedText = normalizeLocationText(text)
  if (!normalizedText) return null

  const matched = locations.find(location => {
    const normalizedName = normalizeLocationText(location.name)
    const normalizedId = normalizeLocationText(location.id.replaceAll("_", " "))
    const genericTokens = new Set(["centro", "clinica", "hospital", "medical", "medico", "salud"])
    const tokens = normalizedName
      .split(/\s+/)
      .filter(token => token.length >= 5 && !genericTokens.has(token))
    const day = location.day ? normalizeLocationText(location.day) : null
    return normalizedText.includes(normalizedName)
      || normalizedText.includes(normalizedId)
      || tokens.some(token => normalizedText.includes(token))
      || Boolean(day && normalizedText.includes(day))
  })

  return matched?.id ?? null
}

async function escalateEmergency(
  session: WhatsAppSession,
  phone: string,
  ctx: SendContext
) {
  const { data: leadId, error } = await getDb().rpc("ensure_whatsapp_lead", {
    p_phone: phone,
    p_name: session.wa_name ?? null,
    p_status: "urgencia_derivada",
    p_possible_emergency: true,
    p_requires_human: true,
    p_source_wa_message_id: ctx.sourceWaMessageId ?? null,
  })
  if (error || typeof leadId !== "string") throw new Error("whatsapp_emergency_lead_transaction_failed")

  const lead = leadId ? await getLead(leadId) : null
  const notifyHandoff = await escalateToHuman({
    leadId,
    reason: "urgencia_medica",
    sourceWaMessageId: ctx.sourceWaMessageId,
    summary: buildHandoffSummary({
      phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1,
      costEstimatedTotal: null, nextStepHint: "Contactar de inmediato — posible urgencia médica",
    }),
  }, { deferNotifications: true })

  // Persist first, then prioritize the fixed patient-facing emergency reply over optional email /
  // internal-WhatsApp alerts. Notification failures never mask the Meta delivery outcome.
  try {
    await sendText(phone, EMERGENCY_REPLY, {
      ...ctx,
      leadId,
      flowIntent: "urgencia_medica",
      requireActiveBot: false,
    })
  } finally {
    if (notifyHandoff) {
      try {
        await notifyHandoff()
      } catch {
        console.error("whatsapp_handoff_notification_failed")
      }
    }
  }
}

async function forceHandoff(session: WhatsAppSession, phone: string, lead: Lead | null, ctx: SendContext, reason: HandoffReason) {
  await escalateToHuman({
    leadId: session.lead_id,
    reason,
    sourceWaMessageId: ctx.sourceWaMessageId,
    summary: buildHandoffSummary({
      phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1,
      costEstimatedTotal: null, nextStepHint: "Retomar la conversación con el paciente",
    }),
  })
  await sendText(phone, "Para no hacerte esperar más, la conversación quedó derivada al equipo de la Dra. Lucía Chahin.", {
    ...ctx,
    leadId: session.lead_id,
    flowIntent: reason,
    requireActiveBot: false,
  })
}

function buildLocationButtons(locations: WhatsAppLocationConfig[]) {
  return locations.map(location => ({
    id: location.id,
    title: location.name.slice(0, 20),
  }))
}

async function sendSedeOptions(
  phone: string,
  ctx: SendContext,
  intro?: string
): Promise<boolean> {
  const locations = await getLocations()
  if (locations.length === 0) {
    await sendButtons(
      phone,
      `${intro ? `${intro}\n\n` : ""}No tengo una lista de sedes vigente y verificada para informarte por este medio. Podés pedir que continúe una persona del equipo.`,
      [{ id: "hablar_humano", title: "Hablar con humano" }],
      { ...ctx, flowIntent: ctx.flowIntent ?? "pedir_turno" }
    )
    return false
  }

  const rows = locations.map(location => {
    const day = location.day ? ` (${location.day})` : ""
    return `🏥 *${location.name}*${day}`
  })
  const question = `${intro ? `${intro}\n\n` : ""}Sedes con datos verificados:\n\n${rows.join("\n")}\n\n¿En cuál preferís atenderte?`
  await sendButtons(phone, question, buildLocationButtons(locations), {
    ...ctx,
    flowIntent: ctx.flowIntent ?? "pedir_turno",
  })
  return true
}

async function getObraSocialOptions(sede?: Sede | null): Promise<{ id: string; title: string }[]> {
  const locations = await getLocations()
  const selectedLocation = sede ? locations.find(location => location.id === sede) : null
  const dynamic = Array.from(new Set(
    (selectedLocation ? selectedLocation.obras_sociales : locations.flatMap(location => location.obras_sociales))
      .filter(name => Boolean(name) && normalizeCoverageName(name) !== "particular")
  ))
  const dynamicRows = dynamic.slice(0, 8).map((name, i) => ({ id: `os_${i}`, title: name.length > 24 ? name.slice(0, 24) : name }))
  return [...dynamicRows, { id: "particular", title: "Particular" }, { id: "otra_obra_social", title: "Otra obra social" }]
}

const CONSENT_BUTTONS = [
  { id: CONSENT_ACCEPT_BUTTON_ID, title: "Acepto y continúo" },
  { id: CONSENT_DECLINE_BUTTON_ID, title: "No acepto" },
]

const FOLLOWUP_CONSENT_BUTTONS = [
  { id: FOLLOWUP_ACCEPT_BUTTON_ID, title: "Sí, una vez" },
  { id: FOLLOWUP_DECLINE_BUTTON_ID, title: "No, gracias" },
]

async function sendInstructionsAndOfferFollowup(
  phone: string,
  sede: Sede,
  intro: string,
  ctx: SendContext,
  insurance?: string | null
): Promise<void> {
  const locations = await getLocations()
  const location = locations.find(item => item.id === sede)
  const coverageNotice = location ? buildCoverageNotice(location, insurance) : null
  const instructions = await buildSedeInstructions(
    sede,
    coverageNotice ? `${intro}\n\n${coverageNotice}` : intro
  )
  if (!instructions) {
    await sendButtons(
      phone,
      "No tengo datos vigentes y verificados de esa sede para indicarte cómo pedir turno. La conversación puede continuar con una persona del equipo.",
      [{ id: "hablar_humano", title: "Hablar con humano" }],
      { ...ctx, flowIntent: "pedir_turno" }
    )
    return
  }

  await sendText(phone, instructions, { ...ctx, flowIntent: "pedir_turno" })
  await sendButtons(phone, FOLLOWUP_CONSENT_TEXT, FOLLOWUP_CONSENT_BUTTONS, {
    ...ctx,
    flowIntent: "appointment_followup_consent",
  })
  await updateSession(phone, { state: "esperando_seguimiento" })
}

async function buildIntakeQuestions(costSavingMode: boolean): Promise<string> {
  const locations = await getLocations()
  const services = [...new Set(locations.flatMap(location => location.services))]
  const locationNames = locations.map(location => {
    return location.day ? `${location.name} (${location.day})` : location.name
  })
  const serviceQuestion = services.length > 0
    ? `1) servicio: ${services.join(", ")} o información administrativa sobre un protocolo`
    : "1) qué gestión administrativa necesitás; una persona puede confirmar los servicios disponibles"
  const locationQuestion = locationNames.length > 0
    ? `3) sede: ${locationNames.join(", ")}.`
    : "No tengo una lista de sedes vigente para ofrecerte automáticamente; podés pedir hablar con una persona."

  return costSavingMode
    ? `Respondeme en un solo mensaje: ${serviceQuestion} 2) obra social/prepaga o particular ${locationQuestion}`
    : `Para ayudarte rápido, respondeme en un solo mensaje:\n${serviceQuestion}.\n2) ¿Qué obra social o prepaga tenés? (o "particular" si no tenés)\n${locationQuestion}`
}

function buildBotIntro(costSavingMode: boolean): string {
  return costSavingMode
    ? "Hola, soy el asistente administrativo de la Dra. Lucía Chahin, cardióloga."
    : "¡Hola! 👋 Soy el asistente administrativo de la *Dra. Lucía Chahin*, cardióloga."
}

// ── TTL de inactividad ─────────────────────────────────────
const STALE_STATES: BotState[] = ["intake_pendiente", "esperando_obra_social", "esperando_sede", "esperando_seguimiento"]

function isStale(session: WhatsAppSession, ttlHours: number): boolean {
  if (!STALE_STATES.includes(session.state) || !session.updated_at) return false
  return Date.now() - new Date(session.updated_at).getTime() > ttlHours * 60 * 60 * 1000
}

export const UNSUPPORTED_MEDIA_REPLY =
  "Por ahora este asistente no puede revisar audios, imágenes, documentos ni estudios. Escribí tu consulta administrativa en texto. Si necesitás enviar documentación, te derivamos con una persona."

function isUnsupportedMessageType(messageType: MessageType): boolean {
  return messageType !== "text" && messageType !== "button_reply" && messageType !== "list_reply"
}

async function getSessionPreferredLocation(session: WhatsAppSession): Promise<Sede | null> {
  if (!session.lead_id) return null
  return leadPreferredSede(await getLead(session.lead_id))
}

// ── Preguntas frecuentes fuera del guion ────────────────────
async function answerFaq(text: string, sede: Sede | null): Promise<string | null> {
  const lower = text.toLowerCase()
  const locations = await getLocations()
  const loc = sede ? locations.find(l => l.id === sede) : undefined
  const sedeName = loc?.name ?? null
  const unverifiedLocationReply =
    "No tengo ese dato vigente y verificado para informarlo por este medio. Podés pedir hablar con una persona del equipo para confirmarlo."

  const asksCoverage = ["obra social", "obras sociales", "cobertura", "prepaga", "pami", "aceptan"].some(k => lower.includes(k))
  if (asksCoverage) {
    if (loc?.obras_sociales?.length) {
      return `En *${sedeName}* la Dra. Lucía Chahin atiende: ${loc.obras_sociales.join(", ")}.\n\nSi la tuya no está en la lista, escribinos y lo confirmamos.`
    }
    return unverifiedLocationReply
  }

  const asksPractices = ["ecocardiograma", "practica", "práctica", "consulta cardiologica", "consulta cardiológica", "que hace", "qué hace", "que hacen", "qué hacen"].some(k => lower.includes(k))
  if (asksPractices) {
    if (!loc?.services.length) return unverifiedLocationReply
    const list = loc.services.join(", ")
    return `${sedeName ? `En *${sedeName}*, la` : "La"} Dra. Lucía Chahin realiza: ${list}.`
  }

  const asksHours = ["horario", "horarios", "que dia", "qué día", "que dias", "qué días", "a que hora", "a qué hora"].some(k => lower.includes(k))
  if (asksHours && sede) {
    if (!loc || (!loc.hours && !loc.day)) return unverifiedLocationReply
    const schedule = loc.hours ? `atiende: ${loc.hours}` : `atiende los ${loc.day}`
    return `En *${loc.name}*, la Dra. Lucía Chahin ${schedule}.`
  }

  const asksAddress = ["direccion", "dirección", "donde queda", "dónde queda", "como llego", "cómo llego", "ubicacion", "ubicación"].some(k => lower.includes(k))
  if (asksAddress && sede) {
    if (!loc?.address) return unverifiedLocationReply
    return `*${loc.name}* está en: ${loc.address}`
  }

  return null
}

export async function handleIncomingMessage(params: {
  phone: string
  text: string
  waName?: string
  messageType?: MessageType
  buttonId?: string
  waMessageId?: string
  referral?: WhatsAppReferral
}) {
  const { phone, text, waName, messageType = "text", buttonId, waMessageId, referral } = params
  let session = await getOrCreateSession(phone)
  const settings = await getWhatsAppSettings()

  // Solo se evalúa la sesión del remitente actual. El reinicio es silencioso: nunca se usa el
  // mensaje de una persona para disparar mensajes hacia otros teléfonos.
  if (isStale(session, settings.session_ttl_hours ?? 24)) {
    await updateSession(phone, { state: "nuevo", obra_social: null })
    session = { ...session, state: "nuevo", obra_social: null }
  }

  const now = new Date()
  const { entryPoint } = referral
    ? detectEntryPoint(referral)
    : { entryPoint: session.entry_point ?? "organic" }
  await updateSession(phone, { last_inbound_at: now.toISOString(), entry_point: entryPoint })
  session = { ...session, last_inbound_at: now.toISOString(), entry_point: entryPoint }

  const windowState = getWindowState(session.last_inbound_at, entryPoint, now)

  const ctx: SendContext = {
    windowState,
    entryPoint,
    leadId: session.lead_id,
    sourceWaMessageId: waMessageId ?? null,
    requireActiveBot: true,
    expectedStateVersion: session.state_version ?? 0,
    serviceMessageChargingEnabled: settings.enable_service_message_charging,
  }

  // Antes del consentimiento solo se conserva metadata operativa (costo/tipo), no el contenido
  // libre del mensaje. La respuesta de aceptación queda acreditada en consent_records.
  const administrativeConsentGranted = await hasConsented(phone)
  const emergencyDetected = messageType === "text" && isEmergencyMessage(text)
  const medicalBoundaryDetected = messageType === "text" && isMedicalBoundaryMessage(text)
  const sensitiveMedicalContentDetected = emergencyDetected || medicalBoundaryDetected ||
    (messageType === "text" && containsSensitiveMedicalContent(text))
  const unsupportedMessage = isUnsupportedMessageType(messageType)
  // Cuando una persona ya tomó la conversación, el Inbox necesita ver lo que el paciente escribe
  // para poder responderle. Esos textos no vuelven al bot ni a un modelo: se guardan con retención
  // corta y acceso restringido. Fuera del handoff se mantiene el filtro conservador original.
  const humanHandoffInboxActive = session.bot_paused && Boolean(session.lead_id) && !unsupportedMessage
  const mayPersistInboundContent = humanHandoffInboxActive || (
    administrativeConsentGranted && !sensitiveMedicalContentDetected && !unsupportedMessage
  )

  await logWhatsAppMessage({
    waId: phone,
    leadId: mayPersistInboundContent ? session.lead_id : null,
    direction: "inbound",
    messageType,
    category: "service",
    isTemplate: false,
    windowState,
    entryPoint,
    content: mayPersistInboundContent ? text : "",
    retentionClass: humanHandoffInboxActive ? "handoff_transient" : "standard",
    waMessageId,
    flowIntent: emergencyDetected
      ? "urgencia_medica"
      : medicalBoundaryDetected
        ? "medical_boundary"
        : sensitiveMedicalContentDetected
          ? "medical_content_redacted"
          : null,
    serviceMessageChargingEnabled: settings.enable_service_message_charging,
  })

  // Fase 1 del shadow mode (2026-07-17, ver whatsapp-policy-shadow-runner.ts): mide la política v2
  // contra esta misma decisión, sin ningún efecto sobre lo que sigue. Nunca lanza ni bloquea.
  if (settings.shadow_mode_enabled) {
    await evaluateWhatsAppPolicyShadow({
      phone,
      text,
      messageType,
      buttonId,
      waMessageId,
      leadId: session.lead_id,
      sessionState: session.state,
      messagesSentCount: session.messages_sent_count,
      handoffMessageThreshold: settings.handoff_message_threshold,
      emergencyDetected,
      marketingOptOut: messageType === "text" && isMarketingOptOutMessage(text),
      unsupportedMessage,
      botPaused: session.bot_paused,
      medicalBoundaryDetected,
      sensitiveMedicalContentDetected,
      botEnabled: settings.bot_enabled,
    })
  }

  if (emergencyDetected) {
    await escalateEmergency(session, phone, ctx)
    return
  }

  // DATA-02: la baja de contacto comercial tiene que ser inmediata (no esperar a la barrida
  // semanal de retención) — chequeada antes que cualquier otra lógica de estado, para que
  // funcione sin importar en qué parte de la conversación esté el paciente.
  if (messageType === "text" && isMarketingOptOutMessage(text)) {
    const leadId = await ensureLeadId(session, phone, waMessageId)
    const db = getDb()
    await recordAppointmentFollowupConsent({
      waId: phone,
      leadId,
      consented: false,
      evidenceMessageId: waMessageId ?? null,
      source: "whatsapp_opt_out",
    })
    const { error } = await db.from("leads").update({
      consent_to_contact: false,
      followup_due_at: null,
      whatsapp_followup_status: "cancelled",
      whatsapp_followup_claimed_at: null,
    }).eq("id", leadId)
    if (error) throw new Error("whatsapp_opt_out_update_failed")
    await sendText(
      phone,
      "Listo, no te vamos a volver a escribir. Si en algún momento querés retomar el contacto, podés escribirnos vos cuando quieras.",
      { ...ctx, leadId, flowIntent: "baja_contacto", requireActiveBot: false }
    )
    return
  }

  // Los adjuntos no se descargan, interpretan ni pasan a IA. Esta confirmación técnica fija sigue
  // disponible con el bot pausado o apagado para que el paciente sepa cómo continuar.
  if (unsupportedMessage) {
    await sendText(phone, UNSUPPORTED_MEDIA_REPLY, {
      ...ctx,
      flowIntent: "unsupported_media",
      requireActiveBot: false,
    })
    return
  }

  // El equipo tomó la conversación a mano desde el Inbox (ver /api/messages): el mensaje del
  // paciente ya quedó logueado arriba, pero el bot no contesta nada más hasta que alguien lo
  // reactive — evita que las dos respuestas (la manual y la del bot) se pisen.
  if (session.bot_paused) return

  // Las preguntas clínicas nunca pasan al clasificador generativo ni producen texto libre. La
  // respuesta sale de este catálogo fijo y mantiene al canal dentro de su alcance administrativo.
  if (medicalBoundaryDetected) {
    await sendText(phone, MEDICAL_BOUNDARY_REPLY, { ...ctx, flowIntent: "medical_boundary" })
    return
  }

  // A symptom/condition statement that is not an emergency or explicit medical question still
  // stays outside storage and AI. Ask the person to repeat only the administrative fields.
  if (sensitiveMedicalContentDetected) {
    await sendText(phone, SENSITIVE_MEDICAL_CONTENT_REPLY, {
      ...ctx,
      flowIntent: "medical_content_redacted",
    })
    return
  }

  // Kill switch operativo: se consulta en cada evento. Los guardrails anteriores siguen activos.
  if (settings.bot_enabled === false) return

  if (session.state === "handoff_pending" || session.state === "human_active" || session.state === "closed") return

  const lead = session.lead_id ? await getLead(session.lead_id) : null

  if (shouldForceHandoff(session.messages_sent_count, settings.handoff_message_threshold, isHighValueLead(lead))) {
    await forceHandoff(session, phone, lead, ctx, "conversacion_larga")
    return
  }

  if (messageType === "button_reply" && buttonId === "hablar_humano") {
    await escalateToHuman({
      leadId: session.lead_id,
      reason: "solicitud_explicita",
      sourceWaMessageId: waMessageId ?? null,
      summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Retomar contacto — el paciente pidió hablar con una persona" }),
    })
    await sendText(phone, await buildHablarConHumanoReply(lead), {
      ...ctx,
      flowIntent: "hablar_con_humano",
      requireActiveBot: false,
    })
    return
  }

  // "No, gracias" is also the exact label of the appointment follow-up decline button. The
  // current state owns that reply; only classify a protocol template response outside this state.
  if (messageType === "button_reply" && session.state !== "esperando_seguimiento") {
    const protocolReply = classifyProtocolButtonReply(text)

    if (protocolReply === "opt_out") {
      const leadId = await ensureLeadId(session, phone, waMessageId)
      const db = getDb()
      await recordResearchProtocolConsent({
        waId: phone,
        leadId,
        consented: false,
        evidenceMessageId: waMessageId ?? null,
      })
      const { error } = await db.from("leads").update({ protocol_opt_out: true, protocol_interest: false }).eq("id", leadId)
      if (error) throw new Error("whatsapp_protocol_preference_update_failed")
      await sendText(phone, "Listo, no te vamos a volver a contactar por protocolos de investigación.", { ...ctx, leadId, flowIntent: "derivar_protocolo" })
      return
    }

    if (protocolReply === "opt_in") {
      const leadId = await ensureLeadId(session, phone, waMessageId)
      const db = getDb()
      await recordResearchProtocolConsent({
        waId: phone,
        leadId,
        consented: true,
        evidenceMessageId: waMessageId ?? null,
      })
      const { error } = await db.from("leads").update({ protocol_interest: true, protocol_opt_out: false, status: "requiere_humano" }).eq("id", leadId)
      if (error) throw new Error("whatsapp_protocol_preference_update_failed")
      const updatedLead = await getLead(leadId)
      await escalateToHuman({
        leadId, reason: "solicitud_explicita",
        sourceWaMessageId: waMessageId ?? null,
        summary: buildHandoffSummary({ phone, lead: toHandoffLead(updatedLead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
      })
      await sendText(phone, "Listo, registramos tu interés y la conversación quedó derivada al equipo. La participación es voluntaria y cualquier evaluación de elegibilidad corresponde exclusivamente al equipo clínico.", {
        ...ctx,
        leadId,
        flowIntent: "derivar_protocolo",
        requireActiveBot: false,
      })
      return
    }
  }

  switch (session.state) {
    case "nuevo": {
      const consented = administrativeConsentGranted
      const intro = buildBotIntro(settings.cost_saving_mode)

      // GROWTH-01: el primer mensaje (el prellenado por la landing) puede traer "Ref: LAN-CARD-01"
      // al final -- se guarda en la sesión ahora porque el lead recién se crea más adelante, en
      // "intake_pendiente" (ver upsertLeadFromIntake).
      const referralCode = messageType === "text" ? extractReferralCode(text).code : null

      if (consented) {
        await sendText(phone, `${intro}\n\n${await buildIntakeQuestions(settings.cost_saving_mode)}`, { ...ctx, flowIntent: "pedir_turno" })
        await updateSession(phone, { state: "intake_pendiente", wa_name: waName ?? null, referral_code: referralCode })
      } else {
        await sendButtons(phone, `${intro}\n\n${CONSENT_TEXT}`, CONSENT_BUTTONS, { ...ctx, flowIntent: "consent_request" })
        // El nombre de perfil no es necesario para pedir consentimiento y no se conserva antes de
        // una aceptación. El código de campaña es un enum conocido, no una copia del mensaje.
        await updateSession(phone, { state: "esperando_consentimiento", wa_name: null, referral_code: referralCode })
      }
      return
    }

    case "esperando_consentimiento": {
      const decision = interpretConsentReply(text, buttonId)
      if (decision === "unknown") {
        await sendButtons(
          phone,
          `Necesitamos una respuesta explícita antes de registrar datos. ${CONSENT_TEXT}`,
          CONSENT_BUTTONS,
          { ...ctx, flowIntent: "consent_request" }
        )
        return
      }

      const consented = decision === "accepted"
      await recordConsent({
        waId: phone,
        leadId: session.lead_id,
        consented,
        evidenceMessageId: waMessageId ?? null,
      })

      if (!consented) {
        await sendText(
          phone,
          "Sin problema. No vamos a registrar datos de atención ni a contactarte por iniciativa nuestra. Conservamos únicamente tu elección para respetarla. Si más adelante querés retomar, podés escribirnos de nuevo.",
          { ...ctx, flowIntent: "consent_declined" }
        )
        await updateSession(phone, { state: "nuevo" })
        return
      }

      await sendText(phone, await buildIntakeQuestions(settings.cost_saving_mode), { ...ctx, flowIntent: "pedir_turno" })
      await updateSession(phone, { state: "intake_pendiente", wa_name: waName ?? null })
      return
    }

    case "intake_pendiente": {
      // Defensa para sesiones históricas que hayan quedado en intake antes de incorporar el estado
      // explícito. Una respuesta con datos administrativos nunca se interpreta como consentimiento.
      if (!administrativeConsentGranted) {
        await sendButtons(phone, CONSENT_TEXT, CONSENT_BUTTONS, { ...ctx, flowIntent: "consent_request" })
        await updateSession(phone, { state: "esperando_consentimiento" })
        return
      }

      const locations = await getLocations()
      const knownObrasSociales = Array.from(new Set(locations.flatMap(l => l.obras_sociales ?? [])))
      const extraction = extractIntake(text, knownObrasSociales, locations)
      const leadId = await upsertLeadFromIntake(
        session,
        waName,
        extraction,
        sensitiveMedicalContentDetected ? "" : text,
        waMessageId,
        administrativeConsentGranted
      )
      session = { ...session, lead_id: leadId }
      ctx.leadId = leadId

      if (extraction.motivo === "protocolo") {
        const db = getDb()
        const { error } = await db.from("leads").update({ protocol_interest: true, status: "requiere_humano" }).eq("id", leadId)
        if (error) throw new Error("whatsapp_protocol_preference_update_failed")
        const updatedLead = await getLead(leadId)
        await escalateToHuman({
          leadId, reason: "solicitud_explicita",
          sourceWaMessageId: waMessageId ?? null,
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(updatedLead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
        })
        await sendText(
          phone,
          "Gracias, registramos tu interés y la conversación quedó derivada al equipo. La participación es voluntaria, requiere un consentimiento específico y cualquier evaluación de elegibilidad corresponde exclusivamente al equipo clínico.",
          { ...ctx, flowIntent: "derivar_protocolo", requireActiveBot: false }
        )
        return
      }

      const verifiedSede = extraction.sede && locations.some(location => location.id === extraction.sede)
        ? extraction.sede
        : null
      if (verifiedSede) {
        await updateLeadLocation(leadId, verifiedSede)
        if (extraction.obraSocial) {
          await updateSession(phone, { obra_social: extraction.obraSocial })
          await sendInstructionsAndOfferFollowup(phone, verifiedSede, "Perfecto.", ctx, extraction.obraSocial)
        } else {
          const options = await getObraSocialOptions(verifiedSede)
          await sendList(phone, "Para terminar, elegí tu obra social o prepaga (o \"Particular\" si no tenés cobertura):", "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
          await updateSession(phone, { state: "esperando_obra_social" })
        }
        return
      }

      await sendSedeOptions(phone, ctx)
      await updateSession(phone, { state: "esperando_sede", obra_social: extraction.obraSocial })
      return
    }

    case "esperando_obra_social": {
      if (messageType !== "text" && buttonId === "otra_obra_social") {
        await sendText(phone, "Contanos el nombre de tu obra social o prepaga.", { ...ctx, flowIntent: "consultar_cobertura" })
        return
      }

      const obraSocial = buttonId === "particular" ? "Particular / sin cobertura" : (text.trim() || "no informada")
      const leadId = session.lead_id
      if (leadId) await updateLeadInsurance(leadId, obraSocial)

      const currentLead = leadId ? await getLead(leadId) : null
      const alreadyDerivado = currentLead?.status === "derivado_cimel" || currentLead?.status === "derivado_swiss" || currentLead?.status === "derivado_britanico"

      if (alreadyDerivado) {
        await updateSession(phone, { obra_social: obraSocial })
        const routedSede = leadPreferredSede(currentLead)
        if (routedSede) {
          await sendInstructionsAndOfferFollowup(phone, routedSede, "Perfecto.", ctx, obraSocial)
        } else {
          await sendText(phone, `Listo, actualicé tu obra social a *${obraSocial}*. ✅`, { ...ctx, flowIntent: "consultar_cobertura" })
          await updateSession(phone, { state: "derivado" })
        }
        return
      }

      const sede = currentLead?.preferred_location === "cimel_lanus" || currentLead?.preferred_location === "swiss_lomas" || currentLead?.preferred_location === "hospital_britanico" ? currentLead.preferred_location : null
      await updateSession(phone, { obra_social: obraSocial })
      if (sede) {
        await sendInstructionsAndOfferFollowup(phone, sede, "Perfecto.", ctx, obraSocial)
      } else {
        await sendSedeOptions(phone, ctx, `Listo, guardamos tu obra social *${obraSocial}*.`)
        await updateSession(phone, { state: "esperando_sede" })
      }
      return
    }

    case "esperando_sede": {
      const locations = await getLocations()
      const sede = parseSede(text, locations, buttonId)
      if (!sede) {
        await sendSedeOptions(phone, ctx, "No entendí bien la opción.")
        return
      }

      if (session.lead_id) await updateLeadLocation(session.lead_id, sede)

      if (session.obra_social) {
        await sendInstructionsAndOfferFollowup(phone, sede, "Perfecto.", ctx, session.obra_social)
      } else {
        const options = await getObraSocialOptions(sede)
        await sendList(phone, "Para terminar, elegí tu obra social o prepaga (o \"Particular\" si no tenés cobertura):", "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
        await updateSession(phone, { state: "esperando_obra_social" })
      }
      return
    }

    case "esperando_seguimiento": {
      const mappedButtonId = buttonId === FOLLOWUP_ACCEPT_BUTTON_ID
        ? CONSENT_ACCEPT_BUTTON_ID
        : buttonId === FOLLOWUP_DECLINE_BUTTON_ID
          ? CONSENT_DECLINE_BUTTON_ID
          : buttonId
      const decision = interpretConsentReply(text, mappedButtonId)
      if (decision === "unknown") {
        await sendButtons(phone, FOLLOWUP_CONSENT_TEXT, FOLLOWUP_CONSENT_BUTTONS, {
          ...ctx,
          flowIntent: "appointment_followup_consent",
        })
        return
      }

      if (!session.lead_id) {
        await updateSession(phone, { state: "nuevo" })
        return
      }

      const consented = decision === "accepted"
      await recordAppointmentFollowupConsent({
        waId: phone,
        leadId: session.lead_id,
        consented,
        evidenceMessageId: waMessageId ?? null,
      })
      const db = getDb()
      const { error: followupUpdateError } = await db.from("leads").update({
        consent_to_contact: consented,
        followup_due_at: consented ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
        whatsapp_followup_sent_at: null,
        whatsapp_followup_claimed_at: null,
        whatsapp_followup_status: consented ? "pending" : "declined",
      }).eq("id", session.lead_id)
      if (followupUpdateError) throw new Error("whatsapp_followup_preference_update_failed")
      await sendText(
        phone,
        consented
          ? "Listo. Te vamos a escribir una sola vez para saber si pudiste pedir el turno."
          : "Listo. No vamos a iniciar un seguimiento; podés escribirnos cuando quieras.",
        { ...ctx, flowIntent: "appointment_followup_consent" }
      )
      await updateSession(phone, { state: "derivado" })
      return
    }

    case "derivado": {
      if (messageType === "text" && wantsToChangeObraSocial(text)) {
        const currentLead = session.lead_id ? await getLead(session.lead_id) : null
        const options = await getObraSocialOptions(leadPreferredSede(currentLead))
        await sendList(phone, `Tenés cargada la obra social *${session.obra_social ?? "no informada"}*. Elegí la nueva (o "Particular" si no tenés cobertura):`, "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
        await updateSession(phone, { state: "esperando_obra_social" })
        return
      }

      if (messageType === "text" && DECLARES_NO_COVERAGE_PATTERN.test(text)) {
        const insurance = "Particular / sin cobertura"
        if (session.lead_id) await updateLeadInsurance(session.lead_id, insurance)
        await updateSession(phone, { obra_social: insurance })
        await sendText(phone, `Listo, actualicé tu obra social a *${insurance}*. ✅`, { ...ctx, flowIntent: "consultar_cobertura" })
        return
      }

      const locations = await getLocations()
      const sede = parseSede(text, locations, buttonId)
      if (sede) {
        if (session.lead_id) await updateLeadLocation(session.lead_id, sede)
        const location = locations.find(item => item.id === sede)
        const coverageNotice = location ? buildCoverageNotice(location, session.obra_social) : null
        const intro = coverageNotice
          ? `Listo, actualicé tu sede preferida.\n\n${coverageNotice}`
          : "Listo, actualicé tu sede preferida."
        const body = await buildSedeInstructions(sede, intro)
        if (body) {
          await sendText(phone, body, { ...ctx, flowIntent: "pedir_turno" })
        } else {
          await sendButtons(
            phone,
            "No tengo datos vigentes y verificados de esa sede. Podés pedir que continúe una persona del equipo.",
            [{ id: "hablar_humano", title: "Hablar con humano" }],
            { ...ctx, flowIntent: "pedir_turno" }
          )
        }
        return
      }

      const isBareGreeting = messageType === "text" && BARE_GREETING_PATTERN.test(text)
      const intent = !isBareGreeting && messageType === "text" ? await classifyIntent(text, settings.ai_provider) : "otro_no_entendido"

      // El clasificador de respaldo solo devuelve un enum. Si detecta una posible urgencia que no
      // estaba cubierta por las reglas, nunca se ignora ni se usa texto redactado por el modelo.
      if (intent === "urgencia_medica") {
        await escalateEmergency(session, phone, ctx)
        return
      }

      // Ola 4 (incidente real 2026-07-14): el paciente cerró la conversación agradeciendo porque ya
      // había conseguido turno en otro lado -- antes esto caía en "pedir_turno" (por la palabra
      // "turno") y el bot reenviaba el menú de sedes, ignorando que ya no necesitaba nada. Se
      // reconoce el cierre y no se vuelve a insistir con instrucciones de sede.
      if (intent === "turno_ya_resuelto") {
        await sendText(
          phone,
          "¡Qué bueno que pudiste conseguir turno! Si en algún momento necesitás algo más, escribinos. 😊",
          { ...ctx, flowIntent: "turno_ya_resuelto" }
        )
        return
      }

      if (intent === "hablar_con_humano" || intent === "cancelar_reprogramar") {
        const replyText = intent === "hablar_con_humano" ? await buildHablarConHumanoReply(lead) : INTENT_REPLIES[intent]!
        await escalateToHuman({
          leadId: session.lead_id, reason: "solicitud_explicita",
          sourceWaMessageId: waMessageId ?? null,
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: intent === "cancelar_reprogramar" ? "Ayudar a cancelar/reprogramar directamente con la institución" : "Retomar contacto — el paciente pidió hablar con una persona" }),
        })
        await sendText(phone, replyText, {
          ...ctx,
          flowIntent: intent,
          requireActiveBot: false,
        })
        return
      }

      if (intent === "derivar_protocolo") {
        if (session.lead_id) {
          const db = getDb()
          const { error } = await db.from("leads").update({ protocol_interest: true, status: "requiere_humano" }).eq("id", session.lead_id)
          if (error) throw new Error("whatsapp_protocol_preference_update_failed")
        }
        await escalateToHuman({
          leadId: session.lead_id, reason: "solicitud_explicita",
          sourceWaMessageId: waMessageId ?? null,
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
        })
        await sendText(phone, "Gracias, registramos tu interés y la conversación quedó derivada al equipo. Cualquier evaluación de elegibilidad corresponde exclusivamente al equipo clínico.", {
          ...ctx,
          flowIntent: "derivar_protocolo",
          requireActiveBot: false,
        })
        return
      }

      const currentSede = await getSessionPreferredLocation(session)
      const faqAnswer = messageType === "text" ? await answerFaq(text, currentSede) : null

      if (faqAnswer) {
        await sendText(phone, faqAnswer, { ...ctx, flowIntent: intent })
        return
      }

      if (intent === "otro_no_entendido" && !isBareGreeting) {
        // Ola 4 (incidente real 2026-07-14): este botón antes solo se ofrecía en cost_saving_mode
        // -- fuera de ese modo (el default), el paciente tenía que escribir la frase exacta para
        // escalar, y eso fue justo lo que le costó varios intentos en el incidente real. No tiene
        // costo extra (WhatsApp no cobra distinto por botones vs texto), así que se ofrece siempre.
        await sendButtons(phone, INTENT_REPLIES.otro_no_entendido!, [{ id: "hablar_humano", title: "Hablar con humano" }], { ...ctx, flowIntent: "otro_no_entendido" })
        return
      }

      const obraSocialLine = session.obra_social && !settings.cost_saving_mode
        ? `\n\nTenés cargada la obra social *${session.obra_social}*. Si cambió, escribinos "cambiar obra social".`
        : ""
      const repeatMessage = settings.cost_saving_mode
        ? "¡Hola! Ya tenés las instrucciones para sacar turno. Elegí una sede o contanos qué necesitás:"
        : `${isBareGreeting ? "¡Hola!" : "Hola de nuevo"} 👋 Ya tenés las instrucciones para sacar turno con la Dra. Lucía Chahin. Si querés volver a ver los datos de una sede, elegí una opción (o escribinos si necesitás otra cosa):${obraSocialLine}`
      await sendSedeOptions(phone, { ...ctx, flowIntent: isBareGreeting ? "otro_no_entendido" : intent }, repeatMessage)
      return
    }
  }
}
