import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { generateReply, getPublicAiError } from "@/lib/ai"
import { sendText, WindowClosedError } from "@/lib/whatsapp"
import { getWindowState } from "@/lib/whatsapp-window"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { resolveHandoffForLead } from "@/lib/whatsapp-handoff"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

const sendMessageSchema = z.object({
  lead_id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(5000),
  generate_reply: z.boolean().optional(),
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lead_id = searchParams.get("lead_id")
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = sendMessageSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const { lead_id, content, generate_reply } = result.data

  const { data: lead } = await supabase.from("leads").select("*").eq("id", lead_id).single()

  // El lead vino del bot de WhatsApp: acá "responder" tiene que llegarle de verdad al paciente por
  // WhatsApp, no solo quedar guardado en esta tabla. Antes de esto, un mensaje escrito acá nunca
  // salía de la app (se guardaba con role "user", como si lo hubiera escrito el paciente).
  if (lead?.phone && lead.origin_channel === "whatsapp") {
    const db = getServiceDb()
    const { data: session } = await db
      .from("whatsapp_sessions")
      .select("last_inbound_at, entry_point")
      .eq("phone", lead.phone)
      .maybeSingle()

    const entryPoint = session?.entry_point ?? "organic"
    const windowState = getWindowState(session?.last_inbound_at ?? null, entryPoint)
    const settings = await getWhatsAppSettings()

    try {
      await sendText(lead.phone, content, {
        windowState,
        entryPoint,
        leadId: lead_id,
        flowIntent: "respuesta_manual",
        serviceMessageChargingEnabled: settings.enable_service_message_charging,
      })
    } catch (error) {
      if (error instanceof WindowClosedError) {
        return NextResponse.json({
          error: "La ventana de 24hs de WhatsApp está cerrada para este paciente. No se puede mandar texto libre — hace falta un template aprobado (Configuración → Templates de WhatsApp), que todavía no se puede elegir desde acá.",
        }, { status: 409 })
      }
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Error enviando el mensaje por WhatsApp",
      }, { status: 500 })
    }

    // El equipo tomó la conversación a mano: el bot deja de responderle a este paciente hasta que
    // alguien lo reactive desde el Inbox (ver /api/whatsapp/bot-pause y el chequeo en whatsapp-bot.ts).
    await db.from("whatsapp_sessions").update({ bot_paused: true }).eq("phone", lead.phone)

    // Ola 4: esta respuesta manual ES la señal de que alguien del equipo tomó la conversación --
    // cierra cualquier handoff abierto de este lead (quita el aviso de "Atención" y lo saca del
    // respaldo diario) sin necesitar un botón aparte de "marcar como resuelto".
    await resolveHandoffForLead(lead_id, user.email ?? "equipo")

    // sendText ya deja el mensaje guardado (role "assistant", saliente) vía logWhatsAppMessage.
    const { data: sentMessage } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    await supabase.from("leads").update({ last_message: content }).eq("id", lead_id)
    return NextResponse.json({ assistant_message: sentMessage })
  }

  const { data: userMessage } = await supabase
    .from("messages")
    .insert({ lead_id, role: "user", content })
    .select()
    .single()

  await supabase.from("leads").update({ last_message: content }).eq("id", lead_id)

  if (!generate_reply) {
    return NextResponse.json({ user_message: userMessage })
  }

  const { data: history } = await supabase
    .from("messages")
    .select("role,content")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: true })
    .limit(20)

  const leadContext = `Lead: ${lead?.name ?? "anónimo"}. Canal: ${lead?.origin_channel}. Servicio: ${lead?.requested_service}. Ubicación preferida: ${lead?.preferred_location}.`
  const conversationHistory = (history ?? []).slice(0, -1) as { role: "user" | "assistant"; content: string }[]

  let replyText: string
  try {
    replyText = await generateReply(content, leadContext, conversationHistory)
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error), user_message: userMessage }, { status: 500 })
  }

  const { data: assistantMessage } = await supabase
    .from("messages")
    .insert({ lead_id, role: "assistant", content: replyText })
    .select()
    .single()

  return NextResponse.json({ user_message: userMessage, assistant_message: assistantMessage })
}
