import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, listReviews } from "@/lib/google-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await listReviews(token, info.google_account_id, info.google_location_id)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
