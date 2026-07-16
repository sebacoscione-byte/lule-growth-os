import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"

const PRICING_READ_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PRICING_READ_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { data, error } = await supabase
    .from("whatsapp_pricing_rules")
    .select("*")
    .order("category")
    .order("valid_from")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
