import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getConnectionInfo, getValidToken, getLocation } from "@/lib/google-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)

  if (!info) return NextResponse.json({ connected: false })

  try {
    const token = await getValidToken(supabase)
    if (!token) return NextResponse.json({ connected: false })

    let profile = null
    if (info.google_location_name) {
      try {
        profile = await getLocation(token, info.google_location_name)
      } catch {
        // profile fetch failed but connection is valid
      }
    }

    return NextResponse.json({
      connected: true,
      accountId: info.google_account_id,
      locationId: info.google_location_id,
      accountName: info.google_account_name,
      locationName: info.google_location_name,
      profile,
    })
  } catch {
    return NextResponse.json({ connected: false })
  }
}
