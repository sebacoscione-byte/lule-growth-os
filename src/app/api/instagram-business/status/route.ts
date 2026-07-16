import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getConnectionInfo, getValidToken } from "@/lib/instagram-business"
import { authorizeStaff } from "@/lib/staff-authz"

const INSTAGRAM_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const authClient = await createClient()
  const auth = await authorizeStaff(authClient, { allowedRoles: INSTAGRAM_BUSINESS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ connected: false })

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    username: info.instagram_username ?? null,
  })
}
