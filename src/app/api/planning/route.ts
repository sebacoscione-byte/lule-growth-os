import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"
import { planningConfigSchema } from "@/lib/practice-planning"

const PLANNING_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PLANNING_ROLES })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const { data, error } = await supabase
    .from("practice_planning")
    .select("config, updated_at")
    .eq("id", "default")
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json(
      { error: "No se pudo cargar la planificación", code: "planning_unavailable" },
      { status: 503 }
    )
  }

  const parsed = planningConfigSchema.safeParse(data.config)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "La planificación guardada no es válida", code: "invalid_planning_config" },
      { status: 503 }
    )
  }

  return NextResponse.json({ config: parsed.data, updated_at: data.updated_at })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PLANNING_ROLES, sensitive: true })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const body = await parseJsonBody(request)
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 })

  const parsed = planningConfigSchema.safeParse(body.data)
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error), code: "invalid_planning_config" },
      { status: 400 }
    )
  }

  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "config_update",
      resourceType: "configuration",
      resourceId: "practice_planning",
      metadata: { config_key: "practice_planning" },
    })
  } catch {
    return NextResponse.json(
      { error: "No se pudo registrar la actualización", code: "audit_unavailable" },
      { status: 503 }
    )
  }

  const { data, error } = await supabase
    .from("practice_planning")
    .upsert(
      {
        id: "default",
        config: parsed.data,
        updated_by: auth.user.id,
      },
      { onConflict: "id" }
    )
    .select("updated_at")
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: "No se pudo guardar la planificación", code: "planning_update_failed" },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true, config: parsed.data, updated_at: data.updated_at })
}
