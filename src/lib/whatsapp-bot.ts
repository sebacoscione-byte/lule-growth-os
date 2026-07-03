import { createClient } from "@supabase/supabase-js"
import { sendText, sendButtons, sendList } from "@/lib/whatsapp"

type BotState = "nuevo" | "esperando_obra_social" | "esperando_sede" | "derivado"
type MessageType = "text" | "button_reply" | "list_reply"

interface WhatsAppSession {
  id: string
  phone: string
  wa_name: string | null
  state: BotState
  obra_social: string | null
  lead_id: string | null
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
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getOrCreateSession(
  phone: string,
  waName?: string
): Promise<WhatsAppSession> {
  const db = getDb()
  const { data: existing } = await db
    .from("whatsapp_sessions")
    .select("*")
    .eq("phone", phone)
    .single()

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
  await db
    .from("whatsapp_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("phone", phone)
}

async function getLocations(): Promise<LocationConfig[]> {
  const db = getDb()
  const { data } = await db
    .from("app_config")
    .select("value")
    .eq("key", "locations")
    .single()

  return Array.isArray(data?.value) ? (data.value as LocationConfig[]) : []
}

async function createLeadFromSession(
  session: WhatsAppSession,
  preferredLocation: "cimel_lanus" | "swiss_lomas"
) {
  const db = getDb()
  const status =
    preferredLocation === "cimel_lanus" ? "derivado_cimel" : "derivado_swiss"

  const { data } = await db
    .from("leads")
    .insert({
      phone: session.phone,
      name: session.wa_name ?? null,
      origin_channel: "whatsapp",
      insurance: session.obra_social ?? null,
      preferred_location: preferredLocation,
      status,
      consent_to_contact: true,
    })
    .select("id")
    .single()

  if (data?.id) {
    await updateSession(session.phone, { lead_id: data.id })
  }

  return data?.id as string | undefined
}

async function updateLeadLocation(
  leadId: string,
  preferredLocation: "cimel_lanus" | "swiss_lomas"
) {
  const db = getDb()
  const status =
    preferredLocation === "cimel_lanus" ? "derivado_cimel" : "derivado_swiss"

  await db
    .from("leads")
    .update({ preferred_location: preferredLocation, status })
    .eq("id", leadId)
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

const SEDE_NAMES: Record<"cimel_lanus" | "swiss_lomas", string> = {
  cimel_lanus: "CIMEL Lanús",
  swiss_lomas: "Swiss Medical Lomas",
}

const SEDE_DEFAULTS: Record<"cimel_lanus" | "swiss_lomas", { address?: string; day: string }> = {
  cimel_lanus: { address: "Tucumán 1314, Lanús", day: "martes" },
  swiss_lomas: { day: "viernes" },
}

async function sendSedeInstructions(
  phone: string,
  sede: "cimel_lanus" | "swiss_lomas",
  intro: string
) {
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

  lines.push(
    "\nSolicitá turno de consulta cardiológica o ecocardiograma con la Dra. Lucía Chahin.\n\n¡Ante cualquier duda, acá estamos! 😊"
  )

  await sendText(phone, lines.join("\n"))
}

function parseSede(text: string, buttonId?: string): "cimel_lanus" | "swiss_lomas" | null {
  if (buttonId === "cimel_lanus") return "cimel_lanus"
  if (buttonId === "swiss_lomas") return "swiss_lomas"

  const lower = text.toLowerCase()
  if (
    lower.includes("cimel") ||
    lower.includes("lanús") ||
    lower.includes("lanus") ||
    lower === "1" ||
    lower.includes("martes")
  ) {
    return "cimel_lanus"
  }
  if (
    lower.includes("swiss") ||
    lower.includes("lomas") ||
    lower === "2" ||
    lower.includes("viernes")
  ) {
    return "swiss_lomas"
  }
  return null
}

const EMERGENCY_KEYWORDS = [
  "dolor de pecho", "dolor en el pecho", "me duele el pecho",
  "no puedo respirar", "falta de aire", "me falta el aire", "ahogo",
  "desmayo", "desmaye", "desmayé", "me desmaye", "me desmayé",
  "perdí el conocimiento", "perdi el conocimiento",
  "convulsion", "convulsión",
  "infarto", "paro cardiaco", "paro cardíaco",
  "palpitaciones fuertes",
  "urgencia", "emergencia", "911",
]

function isEmergencyMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return EMERGENCY_KEYWORDS.some(keyword => lower.includes(keyword))
}

const EMERGENCY_REPLY =
  "🚨 Esto puede ser una urgencia médica y no lo puedo evaluar por este medio.\n\n*Andá a la guardia más cercana ahora mismo* o llamá al *911*.\n\nLe avisamos al equipo de la Dra. Lucía Chahin para que te contacten apenas puedan."

async function escalateEmergency(session: WhatsAppSession, phone: string) {
  const db = getDb()

  if (session.lead_id) {
    await db
      .from("leads")
      .update({ status: "urgencia_derivada", possible_emergency: true, requires_human: true })
      .eq("id", session.lead_id)
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

    if (data?.id) {
      await updateSession(phone, { lead_id: data.id })
    }
  }

  await sendText(phone, EMERGENCY_REPLY)
}

const SEDE_QUESTION =
  "La Dra. Chahin atiende en dos sedes:\n\n🏥 *CIMEL Lanús* — Tucumán 1314 (martes)\n🏥 *Swiss Medical Lomas* (viernes)\n\n¿En cuál preferís atenderte?"

const SEDE_BUTTONS = [
  { id: "cimel_lanus", title: "CIMEL Lanús" },
  { id: "swiss_lomas", title: "Swiss Medical Lomas" },
]

async function getObraSocialOptions(): Promise<{ id: string; title: string }[]> {
  const locations = await getLocations()
  const dynamic = Array.from(
    new Set(locations.flatMap(l => l.obras_sociales ?? []).filter(Boolean))
  )

  const dynamicRows = dynamic.slice(0, 8).map((name, i) => ({
    id: `os_${i}`,
    title: name.length > 24 ? name.slice(0, 24) : name,
  }))

  return [
    ...dynamicRows,
    { id: "particular", title: "Particular" },
    { id: "otra_obra_social", title: "Otra obra social" },
  ]
}

// ── Timeout de inactividad ─────────────────────────────────
const STALE_STATES: BotState[] = ["esperando_obra_social", "esperando_sede"]
const TIMEOUT_MINUTES = 2

const TIMEOUT_REPLY =
  "🕐 Pasaron unos minutos sin respuesta, así que cerramos esta conversación por ahora. Cuando quieras retomar, escribinos de nuevo y arrancamos otra vez. ¡Hasta luego! 👋"

function isStale(session: WhatsAppSession): boolean {
  if (!STALE_STATES.includes(session.state) || !session.updated_at) return false
  const elapsedMs = Date.now() - new Date(session.updated_at).getTime()
  return elapsedMs > TIMEOUT_MINUTES * 60 * 1000
}

// No hay cron de un minuto disponible en el plan actual de Vercel, asi que
// aprovechamos cualquier mensaje entrante para cerrar otras conversaciones
// que quedaron esperando respuesta hace mas de 5 minutos.
async function closeOtherStaleSessions(excludePhone: string) {
  const db = getDb()
  const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString()

  const { data: stale } = await db
    .from("whatsapp_sessions")
    .select("phone")
    .neq("phone", excludePhone)
    .in("state", STALE_STATES)
    .lt("updated_at", cutoff)

  for (const row of (stale ?? []) as { phone: string }[]) {
    await sendText(row.phone, TIMEOUT_REPLY)
    await updateSession(row.phone, { state: "nuevo", obra_social: null })
  }
}

async function getSessionPreferredLocation(
  session: WhatsAppSession
): Promise<"cimel_lanus" | "swiss_lomas" | null> {
  if (!session.lead_id) return null
  const db = getDb()
  const { data } = await db
    .from("leads")
    .select("preferred_location")
    .eq("id", session.lead_id)
    .single()

  const loc = data?.preferred_location
  return loc === "cimel_lanus" || loc === "swiss_lomas" ? loc : null
}

// ── Preguntas frecuentes fuera del guion ────────────────────
async function answerFaq(
  text: string,
  sede: "cimel_lanus" | "swiss_lomas" | null
): Promise<string | null> {
  const lower = text.toLowerCase()
  const locations = await getLocations()
  const loc = sede ? locations.find(l => l.id === sede) : undefined
  const sedeName = sede ? SEDE_NAMES[sede] : null

  const asksCoverage = ["obra social", "obras sociales", "cobertura", "prepaga", "pami", "aceptan"]
    .some(k => lower.includes(k))
  if (asksCoverage) {
    if (loc?.obras_sociales?.length) {
      return `En *${sedeName}* la Dra. Lucía Chahin atiende: ${loc.obras_sociales.join(", ")}.\n\nSi la tuya no está en la lista, escribinos y lo confirmamos.`
    }
    return "Todavía no tengo cargada la lista de obras sociales. Contanos cuál es la tuya y te confirmamos si atiende ahí."
  }

  const asksPractices = [
    "ecocardiograma", "practica", "práctica",
    "consulta cardiologica", "consulta cardiológica",
    "que hace", "qué hace", "que hacen", "qué hacen",
  ].some(k => lower.includes(k))
  if (asksPractices) {
    const list = loc?.practices?.length ? loc.practices.join(", ") : "Consulta cardiológica y Ecocardiograma"
    return `${sedeName ? `En *${sedeName}*, la` : "La"} Dra. Lucía Chahin realiza: ${list}.`
  }

  const asksHours = ["horario", "horarios", "que dia", "qué día", "que dias", "qué días", "a que hora", "a qué hora"]
    .some(k => lower.includes(k))
  if (asksHours && sede) {
    const hours = loc?.hours ?? `atiende los ${SEDE_DEFAULTS[sede].day}`
    return `En *${sedeName}*, la Dra. Lucía Chahin ${loc?.hours ? `atiende: ${hours}` : hours}.`
  }

  const asksAddress = ["direccion", "dirección", "donde queda", "dónde queda", "como llego", "cómo llego", "ubicacion", "ubicación"]
    .some(k => lower.includes(k))
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
}) {
  const { phone, text, waName, messageType = "text", buttonId } = params
  let session = await getOrCreateSession(phone, waName)

  await closeOtherStaleSessions(phone)

  if (isStale(session)) {
    await sendText(phone, TIMEOUT_REPLY)
    await updateSession(phone, { state: "nuevo", obra_social: null })
    session = { ...session, state: "nuevo", obra_social: null }
  }

  if (messageType === "text" && isEmergencyMessage(text)) {
    await escalateEmergency(session, phone)
    return
  }

  switch (session.state) {
    case "nuevo": {
      const options = await getObraSocialOptions()
      await sendList(
        phone,
        "¡Hola! 👋 Soy el asistente de la *Dra. Lucía Chahin*, cardióloga.\n\nElegí tu obra social o prepaga (o \"Particular\" si no tenés cobertura):",
        "Elegir",
        options
      )
      await updateSession(phone, {
        state: "esperando_obra_social",
        wa_name: waName ?? null,
      })
      break
    }

    case "esperando_obra_social": {
      if (messageType !== "text" && buttonId === "otra_obra_social") {
        await sendText(phone, "Contanos el nombre de tu obra social o prepaga.")
        break
      }

      const obraSocial =
        buttonId === "particular" ? "Particular / sin cobertura" : (text.trim() || "no informada")

      if (session.lead_id) {
        // Ya tenia sede asignada: estaba actualizando la obra social, no arrancando de cero.
        await updateSession(phone, { obra_social: obraSocial, state: "derivado" })
        await updateLeadInsurance(session.lead_id, obraSocial)
        await sendText(phone, `Listo, actualicé tu obra social a *${obraSocial}*. ✅`)
        break
      }

      await updateSession(phone, {
        obra_social: obraSocial,
        state: "esperando_sede",
      })
      await sendButtons(phone, `Gracias. ${SEDE_QUESTION}`, SEDE_BUTTONS)
      break
    }

    case "esperando_sede": {
      const sede = parseSede(text, buttonId)

      if (!sede) {
        await sendButtons(
          phone,
          "No entendí bien la opción. ¿En cuál sede preferís atenderte?",
          SEDE_BUTTONS
        )
        break
      }

      await createLeadFromSession(session, sede)
      await updateSession(phone, { state: "derivado" })
      await sendSedeInstructions(phone, sede, "Perfecto.")
      break
    }

    case "derivado": {
      if (messageType === "text" && wantsToChangeObraSocial(text)) {
        const options = await getObraSocialOptions()
        await sendList(
          phone,
          `Tenés cargada la obra social *${session.obra_social ?? "no informada"}*. Elegí la nueva (o "Particular" si no tenés cobertura):`,
          "Elegir",
          options
        )
        await updateSession(phone, { state: "esperando_obra_social" })
        break
      }

      const sede = parseSede(text, buttonId)

      if (sede) {
        if (session.lead_id) {
          await updateLeadLocation(session.lead_id, sede)
        }
        await sendSedeInstructions(phone, sede, "Listo, actualicé tu sede preferida.")
        break
      }

      const currentSede = await getSessionPreferredLocation(session)
      const faqAnswer = messageType === "text" ? await answerFaq(text, currentSede) : null

      if (faqAnswer) {
        await sendText(phone, faqAnswer)
      } else {
        const obraSocialLine = session.obra_social
          ? `\n\nTenés cargada la obra social *${session.obra_social}*. Si cambió, escribinos "cambiar obra social".`
          : ""
        await sendButtons(
          phone,
          `Hola de nuevo 👋 Ya tenés las instrucciones para sacar turno con la Dra. Lucía Chahin. Si querés volver a ver los datos de una sede, elegí una opción (o escribinos si necesitás otra cosa):${obraSocialLine}`,
          SEDE_BUTTONS
        )
      }
      break
    }
  }
}
