import { getServiceDb } from "@/lib/supabase/service"
import { sendText, sendButtons, sendList, type SendContext } from "@/lib/whatsapp"
import { getWindowState, detectEntryPoint, type WhatsAppReferral } from "@/lib/whatsapp-window"
import { extractIntake, classifyIntent, classifyProtocolButtonReply, isMarketingOptOutMessage, INTENT_REPLIES, type IntakeExtraction } from "@/lib/whatsapp-intents"
import { extractReferralCode, findReferralCodeInfo } from "@/lib/landing-referral-codes"
import { isEmergencyMessage, EMERGENCY_REPLY } from "@/lib/medical-safety"
import { CONSENT_TEXT, interpretConsentReply, recordConsent, hasConsented } from "@/lib/whatsapp-consent"
import { buildHandoffSummary, escalateToHuman, type HandoffLeadInfo } from "@/lib/whatsapp-handoff"
import { logWhatsAppMessage } from "@/lib/whatsapp-cost-tracking"
import { getWhatsAppSettings, isHighValueLead, shouldForceHandoff } from "@/lib/whatsapp-settings"
import type { HandoffReason, Lead, WhatsAppEntryPoint } from "@/types"

type BotState = "nuevo" | "intake_pendiente" | "esperando_obra_social" | "esperando_sede" | "derivado"
type MessageType = "text" | "button_reply" | "list_reply"
type Sede = "cimel_lanus" | "swiss_lomas" | "hospital_britanico"

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
  updated_at?: string
}

interface LocationConfig {
  id: string
  name: string
  address?: string
  phone?: string
  hours?: string
  booking_url?: string
  day?: string
  booking_instruction?: string
  obras_sociales?: string[]
  practices?: string[]
}

function getDb() {
  return getServiceDb()
}

async function getOrCreateSession(phone: string, waName?: string): Promise<WhatsAppSession> {
  const db = getDb()
  const { data: existing } = await db.from("whatsapp_sessions").select("*").eq("phone", phone).single()
  if (existing) return existing as WhatsAppSession

  const { data: created, error } = await db
    .from("whatsapp_sessions")
    .insert({ phone, wa_name: waName ?? null, state: "nuevo" })
    .select()
    .single()

  if (error) throw new Error(`Error creando sesión: ${error.message}`)
  return created as WhatsAppSession
}

async function updateSession(phone: string, updates: Partial<WhatsAppSession>) {
  const db = getDb()
  await db.from("whatsapp_sessions").update({ ...updates, updated_at: new Date().toISOString() }).eq("phone", phone)
}

async function getLocations(): Promise<LocationConfig[]> {
  const db = getDb()
  const { data } = await db.from("app_config").select("value").eq("key", "locations").single()
  return Array.isArray(data?.value) ? (data.value as LocationConfig[]) : []
}

async function getLead(leadId: string): Promise<Lead | null> {
  const db = getDb()
  const { data } = await db.from("leads").select("*").eq("id", leadId).maybeSingle()
  return (data as Lead | null) ?? null
}

/** Para respuestas a botones de templates enviados a numeros sin lead previo (ej. una invitacion a protocolo enviada en frio). */
async function ensureLeadId(session: WhatsAppSession, phone: string): Promise<string> {
  if (session.lead_id) return session.lead_id

  const db = getDb()
  const { data, error } = await db
    .from("leads")
    .insert({ phone, name: session.wa_name ?? null, origin_channel: "whatsapp", consent_to_contact: true, status: "interesado" })
    .select("id")
    .single()

  if (error || !data?.id) throw new Error(`Error creando lead: ${error?.message}`)
  await updateSession(phone, { lead_id: data.id })
  return data.id as string
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

/** Crea el lead en la primera respuesta con datos y lo va completando en los turnos siguientes — nunca se pisa un dato ya cargado con uno vacío. */
async function upsertLeadFromIntake(session: WhatsAppSession, waName: string | undefined, extraction: IntakeExtraction): Promise<string> {
  const db = getDb()
  const patch: Partial<Lead> & Record<string, unknown> = {}
  if (extraction.obraSocial) patch.insurance = extraction.obraSocial
  if (extraction.edad) patch.patient_age = extraction.edad
  if (extraction.notas) {
    patch.prior_studies_or_symptoms = extraction.notas
    patch.general_reason = extraction.notas
    patch.last_message = extraction.notas
  }
  if (extraction.motivo) patch.requested_service = REQUESTED_SERVICE_BY_MOTIVO[extraction.motivo]

  if (session.lead_id) {
    await db.from("leads").update(patch).eq("id", session.lead_id)
    return session.lead_id
  }

  // GROWTH-01: si el primer mensaje traía un código de referencia real (ver
  // landing-referral-codes.ts), atribuye el lead a la landing/sede exacta que lo generó. Si el
  // paciente borró o nunca tuvo un código (mensaje orgánico), utm_content/landing_page quedan
  // null -- el embudo del dashboard los muestra como "sin atribuir", no hace falta un valor
  // literal "unknown".
  const referralInfo = session.referral_code ? findReferralCodeInfo(session.referral_code) : null
  if (referralInfo) {
    patch.utm_content = referralInfo.code
    patch.landing_page = referralInfo.landingSlug
  }

  const { data, error } = await db
    .from("leads")
    .insert({
      phone: session.phone,
      name: waName ?? session.wa_name ?? null,
      origin_channel: "whatsapp",
      consent_to_contact: true,
      status: "interesado",
      ...patch,
    })
    .select("id")
    .single()

  if (error || !data?.id) throw new Error(`Error creando lead desde intake: ${error?.message}`)
  await updateSession(session.phone, { lead_id: data.id })
  return data.id as string
}

const STATUS_BY_SEDE: Record<Sede, Lead["status"]> = {
  cimel_lanus: "derivado_cimel",
  swiss_lomas: "derivado_swiss",
  hospital_britanico: "derivado_britanico",
}

async function updateLeadLocation(leadId: string, preferredLocation: Sede) {
  const db = getDb()
  await db.from("leads").update({ preferred_location: preferredLocation, status: STATUS_BY_SEDE[preferredLocation] }).eq("id", leadId)
}

async function updateLeadInsurance(leadId: string, insurance: string) {
  const db = getDb()
  await db.from("leads").update({ insurance }).eq("id", leadId)
}

function wantsToChangeObraSocial(text: string): boolean {
  const lower = text.toLowerCase()
  const mentionsCoverage = ["obra social", "cobertura", "prepaga"].some(k => lower.includes(k))
  const mentionsChange = ["cambi", "actualiz"].some(k => lower.includes(k))
  return mentionsCoverage && mentionsChange
}

const SEDE_NAMES: Record<Sede, string> = {
  cimel_lanus: "CIMEL Lanús",
  swiss_lomas: "Swiss Medical Lomas",
  hospital_britanico: "Hospital Británico",
}

const SEDE_DEFAULTS: Record<Sede, { address?: string; day: string }> = {
  cimel_lanus: { address: "Tucumán 1314, Lanús", day: "martes" },
  swiss_lomas: { day: "viernes" },
  hospital_britanico: { address: "Perdriel 74, CABA", day: "miércoles" },
}

async function buildSedeInstructions(sede: Sede, intro: string): Promise<string> {
  const locations = await getLocations()
  const loc = locations.find(l => l.id === sede)
  const defaults = SEDE_DEFAULTS[sede]

  const lines = [`${intro} Para sacar turno con la *Dra. Lucía Chahin* en *${SEDE_NAMES[sede]}*:`]

  const address = loc?.address ?? defaults.address
  if (address) lines.push(`🏥 Dirección: ${address}`)
  lines.push(`📅 Ella atiende los *${loc?.day ?? defaults.day}*`)
  if (loc?.hours) lines.push(`🕐 Horarios: ${loc.hours}`)
  if (loc?.phone) lines.push(`📞 Turnos telefónicos: *${loc.phone}*`)

  if (sede === "swiss_lomas") {
    if (loc?.booking_url) {
      lines.push(`🔗 Pedí turno desde la app/web de Swiss Medical: ${loc.booking_url}`)
    } else {
      lines.push("📱 Pedí turno por los canales oficiales de *Swiss Medical* (app o web)")
    }
    lines.push("👩‍⚕️ Solicitá a la Dra. Lucía Chahin")
  } else if (loc?.booking_url) {
    lines.push(`🔗 También podés pedir turno online: ${loc.booking_url}`)
  }

  if (loc?.booking_instruction) lines.push(loc.booking_instruction)
  lines.push("\n¡Ante cualquier duda, acá estamos! 😊")

  return lines.join("\n")
}

function parseSede(text: string, buttonId?: string): Sede | null {
  if (buttonId === "cimel_lanus") return "cimel_lanus"
  if (buttonId === "swiss_lomas") return "swiss_lomas"
  if (buttonId === "hospital_britanico") return "hospital_britanico"

  const lower = text.toLowerCase()
  if (lower.includes("cimel") || lower.includes("lanús") || lower.includes("lanus") || lower === "1" || lower.includes("martes")) {
    return "cimel_lanus"
  }
  if (lower.includes("británico") || lower.includes("britanico") || lower === "3" || lower.includes("miércoles") || lower.includes("miercoles")) {
    return "hospital_britanico"
  }
  if (lower.includes("swiss") || lower.includes("lomas") || lower === "2" || lower.includes("viernes")) {
    return "swiss_lomas"
  }
  return null
}

async function escalateEmergency(session: WhatsAppSession, phone: string, ctx: SendContext) {
  const db = getDb()
  let leadId = session.lead_id

  if (leadId) {
    await db.from("leads").update({ status: "urgencia_derivada", possible_emergency: true, requires_human: true }).eq("id", leadId)
  } else {
    const { data } = await db
      .from("leads")
      .insert({
        phone,
        name: session.wa_name ?? null,
        origin_channel: "whatsapp",
        status: "urgencia_derivada",
        possible_emergency: true,
        requires_human: true,
        consent_to_contact: true,
      })
      .select("id")
      .single()
    leadId = data?.id ?? null
    if (leadId) await updateSession(phone, { lead_id: leadId })
  }

  await sendText(phone, EMERGENCY_REPLY, { ...ctx, leadId, flowIntent: "urgencia_medica" })

  const lead = leadId ? await getLead(leadId) : null
  await escalateToHuman({
    leadId,
    reason: "urgencia_medica",
    summary: buildHandoffSummary({
      phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1,
      costEstimatedTotal: null, nextStepHint: "Contactar de inmediato — posible urgencia médica",
    }),
  })
}

async function forceHandoff(session: WhatsAppSession, phone: string, lead: Lead | null, ctx: SendContext, reason: HandoffReason) {
  await sendText(phone, "Para no hacerte esperar más, te derivamos con una persona del equipo de la Dra. Lucía Chahin — te va a contactar a la brevedad.", { ...ctx, leadId: session.lead_id, flowIntent: reason })
  await escalateToHuman({
    leadId: session.lead_id,
    reason,
    summary: buildHandoffSummary({
      phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1,
      costEstimatedTotal: null, nextStepHint: "Retomar la conversación con el paciente",
    }),
  })
}

const SEDE_QUESTION =
  "La Dra. Chahin atiende en tres sedes:\n\n🏥 *CIMEL Lanús* — Tucumán 1314 (martes)\n🏥 *Hospital Británico* — Perdriel 74, CABA (miércoles)\n🏥 *Swiss Medical Lomas* (viernes)\n\n¿En cuál preferís atenderte?"

const SEDE_BUTTONS = [
  { id: "cimel_lanus", title: "CIMEL Lanús" },
  { id: "hospital_britanico", title: "Hospital Británico" },
  { id: "swiss_lomas", title: "Swiss Medical Lomas" },
]

async function getObraSocialOptions(): Promise<{ id: string; title: string }[]> {
  const locations = await getLocations()
  const dynamic = Array.from(new Set(locations.flatMap(l => l.obras_sociales ?? []).filter(Boolean)))
  const dynamicRows = dynamic.slice(0, 8).map((name, i) => ({ id: `os_${i}`, title: name.length > 24 ? name.slice(0, 24) : name }))
  return [...dynamicRows, { id: "particular", title: "Particular" }, { id: "otra_obra_social", title: "Otra obra social" }]
}

// ── Timeout de inactividad ─────────────────────────────────
const STALE_STATES: BotState[] = ["intake_pendiente", "esperando_obra_social", "esperando_sede"]
const TIMEOUT_MINUTES = 2
const TIMEOUT_REPLY =
  "🕐 Pasaron unos minutos sin respuesta, así que cerramos esta conversación por ahora. Cuando quieras retomar, escribinos de nuevo y arrancamos otra vez. ¡Hasta luego! 👋"

function isStale(session: WhatsAppSession): boolean {
  if (!STALE_STATES.includes(session.state) || !session.updated_at) return false
  return Date.now() - new Date(session.updated_at).getTime() > TIMEOUT_MINUTES * 60 * 1000
}

// No hay cron de un minuto disponible en el plan actual de Vercel, asi que
// aprovechamos cualquier mensaje entrante para cerrar otras conversaciones
// que quedaron esperando respuesta hace mas de 2 minutos.
async function closeOtherStaleSessions(excludePhone: string) {
  const db = getDb()
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString()
  const { data: stale } = await db
    .from("whatsapp_sessions")
    .select("phone, entry_point")
    .neq("phone", excludePhone)
    .in("state", STALE_STATES)
    .lt("updated_at", cutoff)

  for (const row of (stale ?? []) as { phone: string; entry_point: WhatsAppEntryPoint | null }[]) {
    try {
      await sendText(row.phone, TIMEOUT_REPLY, {
        windowState: "open", // el timeout es a los 2 min, muy por debajo de la ventana de 24h
        entryPoint: row.entry_point ?? "organic",
        serviceMessageChargingEnabled: false,
        flowIntent: "timeout",
      })
    } catch { /* si fallara el envio, igual reseteamos el estado abajo */ }
    await updateSession(row.phone, { state: "nuevo", obra_social: null })
  }
}

async function getSessionPreferredLocation(session: WhatsAppSession): Promise<Sede | null> {
  if (!session.lead_id) return null
  const lead = await getLead(session.lead_id)
  const loc = lead?.preferred_location
  return loc === "cimel_lanus" || loc === "swiss_lomas" || loc === "hospital_britanico" ? loc : null
}

// ── Preguntas frecuentes fuera del guion ────────────────────
async function answerFaq(text: string, sede: Sede | null): Promise<string | null> {
  const lower = text.toLowerCase()
  const locations = await getLocations()
  const loc = sede ? locations.find(l => l.id === sede) : undefined
  const sedeName = sede ? SEDE_NAMES[sede] : null

  const asksCoverage = ["obra social", "obras sociales", "cobertura", "prepaga", "pami", "aceptan"].some(k => lower.includes(k))
  if (asksCoverage) {
    if (loc?.obras_sociales?.length) {
      return `En *${sedeName}* la Dra. Lucía Chahin atiende: ${loc.obras_sociales.join(", ")}.\n\nSi la tuya no está en la lista, escribinos y lo confirmamos.`
    }
    return "Todavía no tengo cargada la lista de obras sociales. Contanos cuál es la tuya y te confirmamos si atiende ahí."
  }

  const asksPractices = ["ecocardiograma", "practica", "práctica", "consulta cardiologica", "consulta cardiológica", "que hace", "qué hace", "que hacen", "qué hacen"].some(k => lower.includes(k))
  if (asksPractices) {
    const list = loc?.practices?.length ? loc.practices.join(", ") : "Consulta cardiológica y Ecocardiograma"
    return `${sedeName ? `En *${sedeName}*, la` : "La"} Dra. Lucía Chahin realiza: ${list}.`
  }

  const asksHours = ["horario", "horarios", "que dia", "qué día", "que dias", "qué días", "a que hora", "a qué hora"].some(k => lower.includes(k))
  if (asksHours && sede) {
    const hours = loc?.hours ?? `atiende los ${SEDE_DEFAULTS[sede].day}`
    return `En *${sedeName}*, la Dra. Lucía Chahin ${loc?.hours ? `atiende: ${hours}` : hours}.`
  }

  const asksAddress = ["direccion", "dirección", "donde queda", "dónde queda", "como llego", "cómo llego", "ubicacion", "ubicación"].some(k => lower.includes(k))
  if (asksAddress && sede) {
    const address = loc?.address ?? SEDE_DEFAULTS[sede].address
    if (address) return `*${sedeName}* está en: ${address}`
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
  let session = await getOrCreateSession(phone, waName)

  await closeOtherStaleSessions(phone)

  if (isStale(session)) {
    await updateSession(phone, { state: "nuevo", obra_social: null })
    session = { ...session, state: "nuevo", obra_social: null }
  }

  const now = new Date()
  const { entryPoint, ctwaClid } = referral
    ? detectEntryPoint(referral)
    : { entryPoint: session.entry_point ?? "organic", ctwaClid: session.ctwa_clid }
  await updateSession(phone, { last_inbound_at: now.toISOString(), entry_point: entryPoint, ctwa_clid: ctwaClid })
  session = { ...session, last_inbound_at: now.toISOString(), entry_point: entryPoint, ctwa_clid: ctwaClid }

  const windowState = getWindowState(session.last_inbound_at, entryPoint, now)
  const settings = await getWhatsAppSettings()

  const ctx: SendContext = {
    windowState,
    entryPoint,
    leadId: session.lead_id,
    serviceMessageChargingEnabled: settings.enable_service_message_charging,
  }

  await logWhatsAppMessage({
    waId: phone,
    leadId: session.lead_id,
    direction: "inbound",
    messageType,
    category: "service",
    isTemplate: false,
    windowState,
    entryPoint,
    content: text,
    waMessageId,
    serviceMessageChargingEnabled: settings.enable_service_message_charging,
  })

  if (messageType === "text" && isEmergencyMessage(text)) {
    await escalateEmergency(session, phone, ctx)
    return
  }

  // DATA-02: la baja de contacto comercial tiene que ser inmediata (no esperar a la barrida
  // semanal de retención) — chequeada antes que cualquier otra lógica de estado, para que
  // funcione sin importar en qué parte de la conversación esté el paciente.
  if (messageType === "text" && isMarketingOptOutMessage(text)) {
    const leadId = await ensureLeadId(session, phone)
    const db = getDb()
    await db.from("leads").update({ consent_to_contact: false }).eq("id", leadId)
    await sendText(
      phone,
      "Listo, no te vamos a volver a escribir. Si en algún momento querés retomar el contacto, podés escribirnos vos cuando quieras.",
      { ...ctx, leadId, flowIntent: "baja_contacto" }
    )
    return
  }

  // El equipo tomó la conversación a mano desde el Inbox (ver /api/messages): el mensaje del
  // paciente ya quedó logueado arriba, pero el bot no contesta nada más hasta que alguien lo
  // reactive — evita que las dos respuestas (la manual y la del bot) se pisen.
  if (session.bot_paused) return

  const lead = session.lead_id ? await getLead(session.lead_id) : null

  if (shouldForceHandoff(session.messages_sent_count, settings.handoff_message_threshold, isHighValueLead(lead))) {
    await forceHandoff(session, phone, lead, ctx, "conversacion_larga")
    return
  }

  if (messageType === "button_reply" && buttonId === "hablar_humano") {
    await sendText(phone, INTENT_REPLIES.hablar_con_humano!, { ...ctx, flowIntent: "hablar_con_humano" })
    await escalateToHuman({
      leadId: session.lead_id,
      reason: "solicitud_explicita",
      summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Retomar contacto — el paciente pidió hablar con una persona" }),
    })
    return
  }

  if (messageType === "button_reply") {
    const protocolReply = classifyProtocolButtonReply(text)

    if (protocolReply === "opt_out") {
      const leadId = await ensureLeadId(session, phone)
      const db = getDb()
      await db.from("leads").update({ protocol_opt_out: true, protocol_interest: false }).eq("id", leadId)
      await sendText(phone, "Listo, no te vamos a volver a contactar por protocolos de investigación.", { ...ctx, leadId, flowIntent: "derivar_protocolo" })
      return
    }

    if (protocolReply === "opt_in") {
      const leadId = await ensureLeadId(session, phone)
      const db = getDb()
      await db.from("leads").update({ protocol_interest: true, status: "elegible_protocolo" }).eq("id", leadId)
      await sendText(phone, "Genial, el equipo de la Dra. Lucía Chahin te va a contactar para evaluar si sos compatible con el protocolo.", { ...ctx, leadId, flowIntent: "derivar_protocolo" })
      const updatedLead = await getLead(leadId)
      await escalateToHuman({
        leadId, reason: "solicitud_explicita",
        summary: buildHandoffSummary({ phone, lead: toHandoffLead(updatedLead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
      })
      return
    }
  }

  switch (session.state) {
    case "nuevo": {
      const consented = await hasConsented(phone)
      const consentLine = consented ? "" : `\n\n${CONSENT_TEXT}`
      const questions = settings.cost_saving_mode
        ? `\n\nRespondeme en un solo mensaje: 1) turno, estudio o protocolo 2) obra social/prepaga 3) edad 4) sede: CIMEL Lanús, Hospital Británico o Swiss Medical Lomas 5) síntomas o estudios previos, si tenés.`
        : `\n\nPara ayudarte rápido, respondeme en un solo mensaje:\n1) ¿Buscás turno cardiológico, un estudio o consulta por protocolo de investigación?\n2) ¿Qué obra social o prepaga tenés? (o "particular" si no tenés)\n3) ¿Edad del paciente?\n4) ¿En qué sede preferís atenderte: *CIMEL Lanús* (martes), *Hospital Británico* (miércoles) o *Swiss Medical Lomas* (viernes)?\n5) ¿Tenés algún síntoma o estudio previo que quieras contarnos?`
      const intro = settings.cost_saving_mode
        ? "Hola, soy el asistente de la Dra. Lucía Chahin, cardióloga."
        : "¡Hola! 👋 Soy el asistente de la *Dra. Lucía Chahin*, cardióloga."

      // GROWTH-01: el primer mensaje (el prellenado por la landing) puede traer "Ref: LAN-CARD-01"
      // al final -- se guarda en la sesión ahora porque el lead recién se crea más adelante, en
      // "intake_pendiente" (ver upsertLeadFromIntake).
      const referralCode = messageType === "text" ? extractReferralCode(text).code : null

      await sendText(phone, `${intro}${consentLine}${questions}`, { ...ctx, flowIntent: "pedir_turno" })
      await updateSession(phone, { state: "intake_pendiente", wa_name: waName ?? null, referral_code: referralCode })
      return
    }

    case "intake_pendiente": {
      const consented = await hasConsented(phone)
      if (!consented) {
        const accepted = interpretConsentReply(text)
        await recordConsent({ waId: phone, leadId: session.lead_id, consented: accepted })
        if (!accepted) {
          await sendText(
            phone,
            "Sin problema, no vamos a registrar tus datos. Si más adelante querés retomar, escribinos de nuevo. Ante una urgencia, comunicate directo con la guardia.",
            { ...ctx, flowIntent: "otro_no_entendido" }
          )
          await updateSession(phone, { state: "nuevo" })
          return
        }
      }

      const locations = await getLocations()
      const knownObrasSociales = Array.from(new Set(locations.flatMap(l => l.obras_sociales ?? [])))
      const extraction = extractIntake(text, knownObrasSociales)
      const leadId = await upsertLeadFromIntake(session, waName, extraction)
      session = { ...session, lead_id: leadId }
      ctx.leadId = leadId

      if (extraction.motivo === "protocolo") {
        const db = getDb()
        await db.from("leads").update({ protocol_interest: true, status: "elegible_protocolo" }).eq("id", leadId)
        await sendText(
          phone,
          "Gracias, tomamos nota de tu interés en el protocolo de investigación. Alguien del equipo de la Dra. Lucía Chahin te va a contactar para evaluar si sos compatible — es voluntario y requiere tu consentimiento explícito en ese momento.",
          { ...ctx, flowIntent: "derivar_protocolo" }
        )
        const updatedLead = await getLead(leadId)
        await escalateToHuman({
          leadId, reason: "solicitud_explicita",
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(updatedLead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
        })
        await updateSession(phone, { state: "derivado" })
        return
      }

      if (extraction.sede) {
        await updateLeadLocation(leadId, extraction.sede)
        if (extraction.obraSocial) {
          await updateSession(phone, { state: "derivado", obra_social: extraction.obraSocial })
          const body = await buildSedeInstructions(extraction.sede, "Perfecto.")
          await sendText(phone, body, { ...ctx, flowIntent: "pedir_turno" })
        } else {
          await updateSession(phone, { state: "esperando_obra_social" })
          const options = await getObraSocialOptions()
          await sendList(phone, "Para terminar, elegí tu obra social o prepaga (o \"Particular\" si no tenés cobertura):", "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
        }
        return
      }

      await updateSession(phone, { state: "esperando_sede", obra_social: extraction.obraSocial })
      await sendButtons(phone, SEDE_QUESTION, SEDE_BUTTONS, { ...ctx, flowIntent: "pedir_turno" })
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
        await updateSession(phone, { obra_social: obraSocial, state: "derivado" })
        await sendText(phone, `Listo, actualicé tu obra social a *${obraSocial}*. ✅`, { ...ctx, flowIntent: "consultar_cobertura" })
        return
      }

      const sede = currentLead?.preferred_location === "cimel_lanus" || currentLead?.preferred_location === "swiss_lomas" || currentLead?.preferred_location === "hospital_britanico" ? currentLead.preferred_location : null
      await updateSession(phone, { obra_social: obraSocial, state: "derivado" })
      if (sede) {
        const body = await buildSedeInstructions(sede, "Perfecto.")
        await sendText(phone, body, { ...ctx, flowIntent: "pedir_turno" })
      } else {
        await sendText(phone, `Listo, guardamos tu obra social *${obraSocial}*. ¿En qué sede preferís atenderte?`, { ...ctx, flowIntent: "pedir_turno" })
        await updateSession(phone, { state: "esperando_sede" })
      }
      return
    }

    case "esperando_sede": {
      const sede = parseSede(text, buttonId)
      if (!sede) {
        await sendButtons(phone, "No entendí bien la opción. ¿En cuál sede preferís atenderte?", SEDE_BUTTONS, { ...ctx, flowIntent: "pedir_turno" })
        return
      }

      if (session.lead_id) await updateLeadLocation(session.lead_id, sede)

      if (session.obra_social) {
        await updateSession(phone, { state: "derivado" })
        const body = await buildSedeInstructions(sede, "Perfecto.")
        await sendText(phone, body, { ...ctx, flowIntent: "pedir_turno" })
      } else {
        await updateSession(phone, { state: "esperando_obra_social" })
        const options = await getObraSocialOptions()
        await sendList(phone, "Para terminar, elegí tu obra social o prepaga (o \"Particular\" si no tenés cobertura):", "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
      }
      return
    }

    case "derivado": {
      if (messageType === "text" && wantsToChangeObraSocial(text)) {
        const options = await getObraSocialOptions()
        await sendList(phone, `Tenés cargada la obra social *${session.obra_social ?? "no informada"}*. Elegí la nueva (o "Particular" si no tenés cobertura):`, "Elegir", options, { ...ctx, flowIntent: "consultar_cobertura" })
        await updateSession(phone, { state: "esperando_obra_social" })
        return
      }

      const sede = parseSede(text, buttonId)
      if (sede) {
        if (session.lead_id) await updateLeadLocation(session.lead_id, sede)
        const body = await buildSedeInstructions(sede, "Listo, actualicé tu sede preferida.")
        await sendText(phone, body, { ...ctx, flowIntent: "pedir_turno" })
        return
      }

      const intent = messageType === "text" ? await classifyIntent(text, settings.ai_provider) : "otro_no_entendido"

      if (intent === "hablar_con_humano" || intent === "cancelar_reprogramar") {
        await sendText(phone, INTENT_REPLIES[intent]!, { ...ctx, flowIntent: intent })
        await escalateToHuman({
          leadId: session.lead_id, reason: "solicitud_explicita",
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: intent === "cancelar_reprogramar" ? "Ayudar a cancelar/reprogramar directamente con la institución" : "Retomar contacto — el paciente pidió hablar con una persona" }),
        })
        return
      }

      if (intent === "derivar_protocolo") {
        if (session.lead_id) {
          const db = getDb()
          await db.from("leads").update({ protocol_interest: true, status: "elegible_protocolo" }).eq("id", session.lead_id)
        }
        await sendText(phone, "Gracias por tu interés en el protocolo de investigación. Alguien del equipo te va a contactar para evaluar si sos compatible.", { ...ctx, flowIntent: "derivar_protocolo" })
        await escalateToHuman({
          leadId: session.lead_id, reason: "solicitud_explicita",
          summary: buildHandoffSummary({ phone, lead: toHandoffLead(lead), messagesSentCount: session.messages_sent_count + 1, costEstimatedTotal: null, nextStepHint: "Evaluar elegibilidad de protocolo y contactar" }),
        })
        return
      }

      const currentSede = await getSessionPreferredLocation(session)
      const faqAnswer = messageType === "text" ? await answerFaq(text, currentSede) : null

      if (faqAnswer) {
        await sendText(phone, faqAnswer, { ...ctx, flowIntent: intent })
        return
      }

      if (intent === "otro_no_entendido") {
        if (settings.cost_saving_mode) {
          await sendButtons(phone, INTENT_REPLIES.otro_no_entendido!, [{ id: "hablar_humano", title: "Hablar con humano" }], { ...ctx, flowIntent: "otro_no_entendido" })
        } else {
          await sendText(phone, INTENT_REPLIES.otro_no_entendido!, { ...ctx, flowIntent: "otro_no_entendido" })
        }
        return
      }

      const obraSocialLine = session.obra_social && !settings.cost_saving_mode
        ? `\n\nTenés cargada la obra social *${session.obra_social}*. Si cambió, escribinos "cambiar obra social".`
        : ""
      const repeatMessage = settings.cost_saving_mode
        ? "Ya tenés las instrucciones para sacar turno. Elegí una sede o contanos qué necesitás:"
        : `Hola de nuevo 👋 Ya tenés las instrucciones para sacar turno con la Dra. Lucía Chahin. Si querés volver a ver los datos de una sede, elegí una opción (o escribinos si necesitás otra cosa):${obraSocialLine}`
      await sendButtons(phone, repeatMessage, SEDE_BUTTONS, { ...ctx, flowIntent: intent })
      return
    }
  }
}
