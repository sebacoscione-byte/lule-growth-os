import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, listAccounts, listLocations } from "@/lib/google-business"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const accounts = await listAccounts(token)
    const result: Array<{ accountName: string; accountId: string; locationName: string; locationId: string; title: string }> = []

    for (const account of accounts.accounts ?? []) {
      const accountId = account.name.split("/").pop()!
      const locations = await listLocations(token, account.name)
      for (const loc of locations.locations ?? []) {
        result.push({
          accountName: account.name,
          accountId,
          locationName: loc.name,
          locationId: loc.name.split("/").pop()!,
          title: loc.title ?? loc.name,
        })
      }
    }

    return NextResponse.json({ locations: result })
  } catch (e) {
    console.error(`[google-business/locations] ${String(e)}`)
    return NextResponse.json({ error: "No se pudieron consultar las ubicaciones de Google Business" }, { status: 500 })
  }
}
