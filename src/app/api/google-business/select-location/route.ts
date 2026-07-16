import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getConnectionInfo } from "@/lib/google-business"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_OAUTH_ROLES = ["owner"] as const

export async function POST(req: NextRequest) {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_OAUTH_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { accountName, accountId, locationId } = parsedBody.data as {
    accountName?: string; accountId?: string; locationId?: string
  }
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
  const locationWrites = await Promise.all([
    supabase.from("app_config").upsert({ key: "google_location_id", value: normalizedLocationId }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_location_name", value: infoApiLocationName }, { onConflict: "key" }),
  ])
  if (locationWrites.some(result => result.error)) {
    return NextResponse.json({ error: "No se pudo guardar la ubicación de Google Business" }, { status: 500 })
  }

  if (normalizedAccountId) {
    const accountWrites = await Promise.all([
      supabase.from("app_config").upsert({ key: "google_account_id", value: normalizedAccountId }, { onConflict: "key" }),
      supabase.from("app_config").upsert({ key: "google_account_name", value: accountName ?? `accounts/${normalizedAccountId}` }, { onConflict: "key" }),
    ])
    if (accountWrites.some(result => result.error)) {
      return NextResponse.json({ error: "No se pudo guardar la cuenta de Google Business" }, { status: 500 })
    }
  } else {
    const accountDeletes = await Promise.all([
      supabase.from("app_config").delete().eq("key", "google_account_id"),
      supabase.from("app_config").delete().eq("key", "google_account_name"),
    ])
    if (accountDeletes.some(result => result.error)) {
      return NextResponse.json({ error: "No se pudo actualizar la cuenta de Google Business" }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
