import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getConnectionInfo, getValidToken, getLocation } from "@/lib/google-business"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const authClient = await createClient()
  const auth = await authorizeStaff(authClient, { allowedRoles: GOOGLE_BUSINESS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)

  if (!info) return NextResponse.json({ connected: false })

  const token = await getValidToken(supabase).catch(() => null)
  // Había una conexión guardada pero el refresh token ya no es válido — típico cuando
  // el proyecto de Google Cloud sigue en modo "Prueba" (los refresh tokens expiran a los 7 días).
  if (!token) return NextResponse.json({ connected: false, expired: true })

  // Connected but no location selected yet → ask user to pick
  if (!info.google_location_name) {
    return NextResponse.json({ connected: true, needsLocationPick: true })
  }

  let profile = null
  try {
    profile = await getLocation(token, info.google_location_name)
  } catch {
    // profile fetch failed but connection is valid
  }

  return NextResponse.json({
    connected: true,
    needsLocationPick: false,
    accountId: info.google_account_id,
    locationId: info.google_location_id,
    locationName: info.google_location_name,
    profile,
  })
}
