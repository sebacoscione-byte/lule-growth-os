import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { clearTokens } from "@/lib/google-business"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_OAUTH_ROLES = ["owner"] as const

export async function POST() {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_OAUTH_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  try {
    const supabase = getServiceDb()
    await clearTokens(supabase)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`[google-business/disconnect] ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ error: "No se pudo desconectar Google Business" }, { status: 500 })
  }
}
