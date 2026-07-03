import { createClient } from "@supabase/supabase-js"
import { sendText, sendButtons } from "@/lib/whatsapp"

type BotState = "nuevo" | "esperando_obra_social" | "esperando_sede" | "derivado"

interface WhatsAppSession {
  id: string
  phone: string
  wa_name: string | null
  state: BotState
  obra_social: string | null
  lead_id: string | null
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

export async function handleIncomingMessage(params: {
  phone: string
  text: string
  waName?: string
  messageType?: "text" | "button_reply"
  buttonId?: string
}) {
  const { phone, text, waName, messageType = "text", buttonId } = params
  const session = await getOrCreateSession(phone, waName)

  if (messageType === "text" && isEmergencyMessage(text)) {
    await escalateEmergency(session, phone)
    return
  }

  switch (session.state) {
    case "nuevo": {
      await sendText(
        phone,
        "¡Hola! 👋 Soy el asistente de la *Dra. Lucía Chahin*, cardióloga.\n\nPara orientarte mejor, ¿con qué obra social o prepaga consultás? Si atendés por medicina pública o particular, escribilo también."
      )
      await updateSession(phone, {
        state: "esperando_obra_social",
        wa_name: waName ?? null,
      })
      break
    }

    case "esperando_obra_social": {
      const obraSocial = text.trim() || "no informada"
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
      const sede = parseSede(text, buttonId)

      if (sede) {
        if (session.lead_id) {
          await updateLeadLocation(session.lead_id, sede)
        }
        await sendSedeInstructions(phone, sede, "Listo, actualicé tu sede preferida.")
      } else {
        await sendButtons(
          phone,
          "Hola de nuevo 👋 Ya tenés las instrucciones para sacar turno con la Dra. Lucía Chahin. Si querés volver a ver los datos de una sede, elegí una opción (o escribinos si necesitás otra cosa):",
          SEDE_BUTTONS
        )
      }
      break
    }
  }
}
