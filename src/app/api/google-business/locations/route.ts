import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, listAccounts, listLocations } from "@/lib/google-business"

export async function GET() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createServiceClient()
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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
