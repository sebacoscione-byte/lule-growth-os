import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { closeHandoffForLead, resolveHandoffForLead, takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { formatZodError, parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit, type SecurityAuditAction } from "@/lib/security-audit"

const actionSchema = z.object({
  lead_id: z.string().trim().min(1),
  action: z.enum(["take", "reactivate", "close"]),
}).strict()

const HANDOFF_ROLES = ["owner", "doctor", "reception"] as const
const AUDIT_ACTIONS: Record<z.infer<typeof actionSchema>["action"], SecurityAuditAction> = {
  take: "handoff_take",
  reactivate: "handoff_reactivate",
  close: "handoff_close",
}

/** Acciones explícitas del Inbox; evita que un toggle ambiguo cierre o reactive por accidente. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: HANDOFF_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsed = await parseJsonBody(request)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const body = actionSchema.safeParse(parsed.data)
  if (!body.success) return NextResponse.json({ error: formatZodError(body.error) }, { status: 400 })

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: AUDIT_ACTIONS[body.data.action],
      resourceType: "whatsapp_conversation",
      resourceId: body.data.lead_id,
      metadata: { handoff_action: body.data.action },
    })

    const actor = auth.user.id
    let reactivation = null
    if (body.data.action === "take") await takeHandoffForLead(body.data.lead_id, actor)
    if (body.data.action === "reactivate") reactivation = await resolveHandoffForLead(body.data.lead_id, actor)
    if (body.data.action === "close") await closeHandoffForLead(body.data.lead_id, actor)

    return NextResponse.json({
      ok: true,
      action: body.data.action,
      ...(reactivation ? {
        notice_sent: reactivation.noticeSent,
        notice_status: reactivation.noticeStatus,
      } : {}),
    })
  } catch {
    return NextResponse.json({ error: "No se pudo ejecutar la acción de handoff" }, { status: 503 })
  }
}
