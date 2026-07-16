import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const EXPERIMENT_ROLES = ["owner", "doctor"] as const

// La UI (experimentos/page.tsx) solo actualiza el resultado de un experimento ya creado — se
// mantiene como allowlist estricta en vez de aceptar el body entero (antes hacía
// `.update(body)` sin ningún filtro, permitiendo pisar cualquier columna incluida `channel` o
// `created_at` con un request armado a mano).
const updateResultSchema = z.object({
  result: z.string().trim().max(2000).optional().nullable(),
  winner: z.boolean().optional().nullable(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: EXPERIMENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = updateResultSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("growth_experiments")
    .update(result.data)
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: EXPERIMENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { error } = await supabase.from("growth_experiments").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
