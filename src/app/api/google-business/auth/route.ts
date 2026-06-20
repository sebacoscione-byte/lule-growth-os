import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  GOOGLE_OAUTH_COOKIE_MAX_AGE,
  GOOGLE_OAUTH_REDIRECT_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
  createOauthState,
  createPkcePair,
  getGoogleRedirectUri,
  isSecureRequest,
} from "@/lib/google-oauth"

const SCOPES = ["https://www.googleapis.com/auth/business.manage"].join(" ")

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = getGoogleRedirectUri(request)

  if (!clientId) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 })
  }

  const state = createOauthState()
  const pkce = createPkcePair()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  })

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  const cookieOptions = {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/api/google-business",
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE,
  }

  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, cookieOptions)
  response.cookies.set(GOOGLE_OAUTH_VERIFIER_COOKIE, pkce.verifier, cookieOptions)
  response.cookies.set(GOOGLE_OAUTH_REDIRECT_COOKIE, redirectUri, cookieOptions)

  return response
}
