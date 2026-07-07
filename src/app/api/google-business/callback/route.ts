import { NextRequest, NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import { saveTokens, listAccounts, listLocations } from "@/lib/google-business"
import {
  GOOGLE_OAUTH_REDIRECT_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
  getGoogleRedirectUri,
} from "@/lib/google-oauth"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const error = req.nextUrl.searchParams.get("error")
  const state = req.nextUrl.searchParams.get("state")
  const expectedState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = req.cookies.get(GOOGLE_OAUTH_VERIFIER_COOKIE)?.value
  const redirectUri = req.cookies.get(GOOGLE_OAUTH_REDIRECT_COOKIE)?.value ?? getGoogleRedirectUri(req)

  if (error || !code) {
    return NextResponse.redirect(new URL("/google-local?error=auth_denied", req.url))
  }

  if (!state || !expectedState || state !== expectedState || !codeVerifier) {
    return NextResponse.redirect(new URL("/google-local?error=oauth_state", req.url))
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/google-local?error=token_exchange", req.url))
  }

  const tokens = await tokenRes.json()
  const supabase = getServiceDb()

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

  const response = NextResponse.redirect(new URL("/google-local?connected=1", req.url))
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { path: "/api/google-business", maxAge: 0 })
  response.cookies.set(GOOGLE_OAUTH_VERIFIER_COOKIE, "", { path: "/api/google-business", maxAge: 0 })
  response.cookies.set(GOOGLE_OAUTH_REDIRECT_COOKIE, "", { path: "/api/google-business", maxAge: 0 })

  return response
}
