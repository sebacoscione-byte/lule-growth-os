import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { generateReply, getPublicAiError } from "@/lib/ai"
import { sendText, WindowClosedError } from "@/lib/whatsapp"
import { getWindowState } from "@/lib/whatsapp-window"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

const INBOX_ROLES = ["owner", "doctor", "reception"] as const

const sendMessageSchema = z.object({
  lead_id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(5000),
  generate_reply: z.boolean().optional(),
  delivery_key: z.string().uuid().optional(),
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lead_id = searchParams.get("lead_id")
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: INBOX_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

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
  const auth = await authorizeStaff(supabase, { allowedRoles: INBOX_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = sendMessageSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const { lead_id, content, generate_reply, delivery_key } = result.data

  const { data: lead, error: leadError } = await supabase.from("leads").select("*").eq("id", lead_id).single()
  if (leadError || !lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 })

  // El lead vino del bot de WhatsApp: acá "responder" tiene que llegarle de verdad al paciente por
  // WhatsApp, no solo quedar guardado en esta tabla. Antes de esto, un mensaje escrito acá nunca
  // salía de la app (se guardaba con role "user", como si lo hubiera escrito el paciente).
  if (lead?.phone && lead.origin_channel === "whatsapp") {
    if (!delivery_key) {
      return NextResponse.json({ error: "delivery_key requerido para WhatsApp" }, { status: 400 })
    }
    const db = getServiceDb()
    const { data: session } = await db
      .from("whatsapp_sessions")
      .select("last_inbound_at, entry_point")
      .eq("phone", lead.phone)
      .maybeSingle()

    const entryPoint = session?.entry_point ?? "organic"
    const windowState = getWindowState(session?.last_inbound_at ?? null, entryPoint)
    const settings = await getWhatsAppSettings()

    if (windowState === "closed") {
      return NextResponse.json({
        error: "La ventana de 24hs de WhatsApp está cerrada para este paciente. No se puede mandar texto libre — hace falta un template aprobado (Configuración → Templates de WhatsApp), que todavía no se puede elegir desde acá.",
      }, { status: 409 })
    }

    try {
      await recordSecurityAudit({
        actorUserId: auth.user.id,
        actorRole: auth.role,
        action: "manual_message_send",
        resourceType: "whatsapp_conversation",
        resourceId: lead_id,
        metadata: { channel: "whatsapp" },
      })
    } catch {
      return NextResponse.json({ error: "No se pudo registrar la acción de seguridad" }, { status: 503 })
    }

    // Reservar la conversación para el equipo antes del envío evita una respuesta automática
    // concurrente mientras la llamada a Meta está en curso. Si el envío falla, queda pausada de
    // forma conservadora y el operador puede reactivarla explícitamente.
    await takeHandoffForLead(lead_id, auth.user.id)

    try {
      await sendText(lead.phone, content, {
        windowState,
        entryPoint,
        leadId: lead_id,
        flowIntent: "respuesta_manual",
        deliveryKey: `manual:${delivery_key}`,
        outboundStep: "manual_response",
        serviceMessageChargingEnabled: settings.enable_service_message_charging,
      })
    } catch (error) {
      if (error instanceof WindowClosedError) {
        return NextResponse.json({
          error: "La ventana de 24hs de WhatsApp está cerrada para este paciente. No se puede mandar texto libre — hace falta un template aprobado (Configuración → Templates de WhatsApp), que todavía no se puede elegir desde acá.",
        }, { status: 409 })
      }
      return NextResponse.json({
        error: "No se pudo confirmar el envío por WhatsApp. La conversación quedó pausada para revisión.",
      }, { status: 500 })
    }

    // sendText ya deja el mensaje guardado (role "assistant", saliente) vía logWhatsAppMessage.
    const { data: sentMessage } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    const { error: leadUpdateError } = await supabase.from("leads").update({ last_message: content }).eq("id", lead_id)
    if (leadUpdateError) {
      return NextResponse.json({ error: "El mensaje se envió, pero no se pudo actualizar la ficha" }, { status: 503 })
    }
    return NextResponse.json({ assistant_message: sentMessage })
  }

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "manual_message_send",
      resourceType: "lead",
      resourceId: lead_id,
      metadata: { channel: "internal", ai_requested: generate_reply === true },
    })
  } catch {
    return NextResponse.json({ error: "No se pudo registrar la acción de seguridad" }, { status: 503 })
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
