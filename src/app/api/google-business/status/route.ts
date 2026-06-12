import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getConnectionInfo, getValidToken, getLocation } from "@/lib/google-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)

  if (!info) return NextResponse.json({ connected: false })

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ connected: false })

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
