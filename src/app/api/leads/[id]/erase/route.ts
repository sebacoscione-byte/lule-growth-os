import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { DataErasureDispatchInFlightError, eraseLead } from "@/lib/data-erasure"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, {
    allowedRoles: ["owner", "doctor"],
    sensitive: true,
  })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { id } = await params

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "lead_erasure_request",
      resourceType: "lead",
      resourceId: id,
    })
    await eraseLead(id, auth.user.id)
  } catch (error) {
    if (error instanceof DataErasureDispatchInFlightError) {
      return NextResponse.json({
        error: "Hay un envío de WhatsApp terminando. Reintentá el borrado en unos segundos.",
        code: "dispatch_in_flight",
      }, { status: 409 })
    }
    return NextResponse.json({ error: "No se pudo eliminar la información solicitada" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
