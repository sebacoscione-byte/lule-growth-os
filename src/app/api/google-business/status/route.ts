import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getConnectionInfo, getValidToken, getLocation, listAccounts, listLocations } from "@/lib/google-business"
import type { SupabaseClient } from "@supabase/supabase-js"

async function discoverAndSaveLocation(supabase: SupabaseClient, token: string) {
  const accounts = await listAccounts(token)
  for (const account of accounts.accounts ?? []) {
    const accountId = account.name.split("/").pop()!
    const locations = await listLocations(token, account.name)
    const target = (locations.locations ?? []).find(
      l => "title" in l && typeof l.title === "string" && l.title.toLowerCase().includes("chahin")
    ) ?? (locations.locations ?? [])[0]

    if (target) {
      const locationId = target.name.split("/").pop()!
      await Promise.all([
        supabase.from("app_config").upsert({ key: "google_account_id", value: accountId }, { onConflict: "key" }),
        supabase.from("app_config").upsert({ key: "google_location_id", value: locationId }, { onConflict: "key" }),
        supabase.from("app_config").upsert({ key: "google_account_name", value: account.name }, { onConflict: "key" }),
        supabase.from("app_config").upsert({ key: "google_location_name", value: target.name }, { onConflict: "key" }),
      ])
      return { accountId, locationId, accountName: account.name, locationName: target.name }
    }
  }
  return null
}

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)

  if (!info) return NextResponse.json({ connected: false })

  try {
    const token = await getValidToken(supabase)
    if (!token) return NextResponse.json({ connected: false })

    // Auto-discover location if missing
    let resolved = info
    if (!info.google_location_name) {
      const discovered = await discoverAndSaveLocation(supabase, token)
      if (discovered) {
        resolved = { ...info, ...discovered }
      }
    }

    let profile = null
    if (resolved.google_location_name) {
      try {
        profile = await getLocation(token, resolved.google_location_name)
      } catch {
        // profile fetch failed but connection is valid
      }
    }

    return NextResponse.json({
      connected: true,
      accountId: resolved.google_account_id,
      locationId: resolved.google_location_id,
      accountName: resolved.google_account_name,
      locationName: resolved.google_location_name,
      profile,
    })
  } catch {
    return NextResponse.json({ connected: false })
  }
}
