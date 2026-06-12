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
    const firstAccount = accounts.accounts?.[0]
    if (firstAccount) {
      const accountId = firstAccount.name.split("/").pop()!
      const locations = await listLocations(tokens.access_token, firstAccount.name)
      const firstLocation = locations.locations?.[0]
      if (firstLocation) {
        const locationId = firstLocation.name.split("/").pop()!
        await Promise.all([
          supabase.from("app_config").upsert({ key: "google_account_id", value: accountId }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_location_id", value: locationId }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_account_name", value: firstAccount.name }, { onConflict: "key" }),
          supabase.from("app_config").upsert({ key: "google_location_name", value: firstLocation.name }, { onConflict: "key" }),
        ])
      }
    }
  } catch {
    // Non-fatal: tokens saved, location discovery failed
  }

  return NextResponse.redirect(new URL("/google-local?connected=1", req.url))
}
