import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const PRICING_WRITE_ROLES = ["owner"] as const

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PRICING_WRITE_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { cost_amount } = parsedBody.data as { cost_amount: number | null }
  if (cost_amount !== null && (typeof cost_amount !== "number" || cost_amount < 0)) {
    return NextResponse.json({ error: "cost_amount inválido" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("whatsapp_pricing_rules")
    .update({ cost_amount })
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
