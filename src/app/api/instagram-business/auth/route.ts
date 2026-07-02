import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  INSTAGRAM_OAUTH_COOKIE_MAX_AGE,
  INSTAGRAM_OAUTH_REDIRECT_COOKIE,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  createOauthState,
  getInstagramRedirectUri,
  isSecureRequest,
} from "@/lib/instagram-oauth"

const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"].join(",")

export async function GET(request: NextRequest) {
  const appId = process.env.INSTAGRAM_APP_ID
  const redirectUri = getInstagramRedirectUri(request)

  if (!appId) {
    return NextResponse.json({ error: "Instagram OAuth no esta configurado" }, { status: 500 })
  }

  const state = createOauthState()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
  })

  const response = NextResponse.redirect(`https://www.instagram.com/oauth/authorize?${params}`)
  const cookieOptions = {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/api/instagram-business",
    maxAge: INSTAGRAM_OAUTH_COOKIE_MAX_AGE,
  }

  response.cookies.set(INSTAGRAM_OAUTH_STATE_COOKIE, state, cookieOptions)
  response.cookies.set(INSTAGRAM_OAUTH_REDIRECT_COOKIE, redirectUri, cookieOptions)

  return response
}
