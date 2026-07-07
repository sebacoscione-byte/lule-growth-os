import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getConnectionInfo } from "@/lib/google-business"

export async function POST(req: NextRequest) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { accountName, accountId, locationId } = await req.json()
  const normalizedLocationId = String(locationId ?? "").trim().split("/").pop()
  const normalizedAccountId = String(accountId ?? "").trim().split("/").pop()

  if (!normalizedLocationId) {
    return NextResponse.json({ error: "locationId required" }, { status: 400 })
  }

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  // locationName from v4 API is "accounts/{accountId}/locations/{locationId}"
  // Business Information API needs "locations/{locationId}"
  const infoApiLocationName = `locations/${normalizedLocationId}`
  await Promise.all([
    supabase.from("app_config").upsert({ key: "google_location_id", value: normalizedLocationId }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_location_name", value: infoApiLocationName }, { onConflict: "key" }),
  ])

  if (normalizedAccountId) {
    await Promise.all([
      supabase.from("app_config").upsert({ key: "google_account_id", value: normalizedAccountId }, { onConflict: "key" }),
      supabase.from("app_config").upsert({ key: "google_account_name", value: accountName ?? `accounts/${normalizedAccountId}` }, { onConflict: "key" }),
    ])
  } else {
    await Promise.all([
      supabase.from("app_config").delete().eq("key", "google_account_id"),
      supabase.from("app_config").delete().eq("key", "google_account_name"),
    ])
  }

  return NextResponse.json({ ok: true })
}
