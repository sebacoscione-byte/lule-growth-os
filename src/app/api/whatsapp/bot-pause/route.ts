import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { resolveHandoffForLead, takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

const HANDOFF_ROLES = ["owner", "doctor", "reception"] as const

/** Deja de responder el bot para la conversación de WhatsApp de este lead (ver /lib/whatsapp-bot.ts,
 * chequeo de `session.bot_paused`) — para cuando el equipo toma la conversación a mano desde el Inbox. */

async function getLeadPhone(lead_id: string) {
  const supabase = await createClient()
  const { data: lead } = await supabase.from("leads").select("phone, origin_channel").eq("id", lead_id).single()
  if (!lead?.phone || lead.origin_channel !== "whatsapp") return null
  return lead.phone as string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: HANDOFF_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const lead_id = searchParams.get("lead_id")
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const phone = await getLeadPhone(lead_id)
  if (!phone) return NextResponse.json({ error: "Este lead no tiene una conversación de WhatsApp conectada" }, { status: 400 })

  const db = getServiceDb()
  const { data: session } = await db.from("whatsapp_sessions").select("bot_paused, state").eq("phone", phone).maybeSingle()
  return NextResponse.json({ paused: session?.bot_paused ?? false, state: session?.state ?? "nuevo" })
}

const patchSchema = z.object({
  lead_id: z.string().trim().min(1),
  paused: z.boolean(),
})

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: HANDOFF_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = patchSchema.safeParse(parsedBody.data)
  if (!result.success) return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })

  const phone = await getLeadPhone(result.data.lead_id)
  if (!phone) return NextResponse.json({ error: "Este lead no tiene una conversación de WhatsApp conectada" }, { status: 400 })

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: result.data.paused ? "bot_pause" : "bot_reactivate",
      resourceType: "whatsapp_conversation",
      resourceId: result.data.lead_id,
      metadata: { paused: result.data.paused },
    })
    let reactivation = null
    if (result.data.paused) {
      await takeHandoffForLead(result.data.lead_id, auth.user.id)
    } else {
      reactivation = await resolveHandoffForLead(result.data.lead_id, auth.user.id)
    }
    return NextResponse.json({
      paused: result.data.paused,
      ...(reactivation ? {
        notice_sent: reactivation.noticeSent,
        notice_status: reactivation.noticeStatus,
      } : {}),
    })
  } catch {
    return NextResponse.json({ error: "No se pudo cambiar el estado del bot" }, { status: 503 })
  }
}
