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

      if (sede === "cimel_lanus") {
        const locations = await getLocations()
        const cimel = locations.find(l => l.id === "cimel_lanus")
        const phoneText = cimel?.phone ? `\n📞 *${cimel.phone}*` : ""
        await sendText(
          phone,
          `Perfecto. Para sacar turno con la *Dra. Lucía Chahin* en *CIMEL Lanús*:${phoneText}\n🏥 Dirección: Tucumán 1314, Lanús\n📅 Ella atiende los *martes*\n\nSolicitá turno de consulta cardiológica o ecocardiograma con la Dra. Lucía Chahin.\n\n¡Ante cualquier duda, acá estamos! 😊`
        )
      } else {
        const locations = await getLocations()
        const swiss = locations.find(l => l.id === "swiss_lomas")
        const swissPhone = swiss?.phone || "0810-333-8876"
        await sendText(
          phone,
          `Perfecto. Para sacar turno con la *Dra. Lucía Chahin* en *Swiss Medical Lomas*:\n\n📞 Llamá al *${swissPhone}* o buscala en la *app de Swiss Medical*\n👩‍⚕️ Solicitá turno con la Dra. Lucía Chahin\n📅 Ella atiende los *viernes*\n\nIndicá si buscás consulta cardiológica o ecocardiograma.\n\n¡Ante cualquier duda, acá estamos! 😊`
        )
      }
      break
    }

    case "derivado": {
      await sendText(
        phone,
        "Hola de nuevo 👋 Ya tenés las instrucciones para sacar turno con la Dra. Lucía Chahin. Si tuviste algún problema o necesitás más info, contanos y te ayudamos."
      )
      break
    }
  }
}
