import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { saveTokens, listAccounts, listLocations } from "@/lib/google-business"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const error = req.nextUrl.searchParams.get("error")

  if (error || !code) {
    return NextResponse.redirect(new URL("/google-local?error=auth_denied", req.url))
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/google-local?error=token_exchange", req.url))
  }

  const tokens = await tokenRes.json()
  const supabase = await createServiceClient()

  await saveTokens(supabase, tokens)

  // Discover and save account + location IDs
  try {
    const accounts = await listAccounts(tokens.access_token)
    for (const account of accounts.accounts ?? []) {
      const accountId = account.name.split("/").pop()!
      const locations = await listLocations(tokens.access_token, account.name)
      // Prefer location whose title matches "Lucía Chahin" or "Lucia Chahin"
      const target = (locations.locations ?? []).find(
        l => "title" in l && typeof l.title === "string" &&
          l.title.toLowerCase().includes("chahin")
      ) ?? (locations.locations ?? [])[0]

      if (target) {
        const locationId = target.name.split("/").pop()!
        // Business Information API needs "locations/{locationId}" format
        const infoApiLocationName = `locations/${locationId}`
        await Promise.all([
          supabase.from("app_config").upsert({ key: "google_account_id", value: accountId }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_location_id", value: locationId }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_account_name", value: account.name }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_location_name", value: infoApiLocationName }, { onConflict: "key" }),
        ])
        break // found the right location
      }
    }
  } catch {
    // Non-fatal: tokens saved, location discovery failed
  }

  return NextResponse.redirect(new URL("/google-local?connected=1", req.url))
}
