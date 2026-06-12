import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getConnectionInfo } from "@/lib/google-business"

export async function POST(req: NextRequest) {
  const { accountName, accountId, locationName, locationId } = await req.json()
  if (!locationName || !locationId) {
    return NextResponse.json({ error: "locationName and locationId required" }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  await Promise.all([
    supabase.from("app_config").upsert({ key: "google_account_id", value: accountId }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_location_id", value: locationId }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_account_name", value: accountName }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_location_name", value: locationName }, { onConflict: "key" }),
  ])

  return NextResponse.json({ ok: true })
}
