import { NextRequest, NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import { exchangeCodeForToken, exchangeForLongLivedToken, getProfile, saveTokens } from "@/lib/instagram-business"
import {
  INSTAGRAM_OAUTH_REDIRECT_COOKIE,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  getInstagramRedirectUri,
} from "@/lib/instagram-oauth"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const error = req.nextUrl.searchParams.get("error")
  const state = req.nextUrl.searchParams.get("state")
  const expectedState = req.cookies.get(INSTAGRAM_OAUTH_STATE_COOKIE)?.value
  const redirectUri = req.cookies.get(INSTAGRAM_OAUTH_REDIRECT_COOKIE)?.value ?? getInstagramRedirectUri(req)

  if (error || !code) {
    return NextResponse.redirect(new URL("/contenido/instagram?ig_error=auth_denied", req.url))
  }
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/contenido/instagram?ig_error=oauth_state", req.url))
  }

  try {
    const shortLived = await exchangeCodeForToken(code, redirectUri)
    const longLived = await exchangeForLongLivedToken(shortLived.access_token)
    const profile = await getProfile(longLived.access_token)

    const supabase = getServiceDb()
    await saveTokens(supabase, {
      access_token: longLived.access_token,
      expires_in: longLived.expires_in,
      user_id: shortLived.user_id,
    })
    await supabase.from("app_config").upsert({ key: "instagram_username", value: profile.username }, { onConflict: "key" })
  } catch {
    return NextResponse.redirect(new URL("/contenido/instagram?ig_error=token_exchange", req.url))
  }

  const response = NextResponse.redirect(new URL("/contenido/instagram?ig_connected=1", req.url))
  response.cookies.set(INSTAGRAM_OAUTH_STATE_COOKIE, "", { path: "/api/instagram-business", maxAge: 0 })
  response.cookies.set(INSTAGRAM_OAUTH_REDIRECT_COOKIE, "", { path: "/api/instagram-business", maxAge: 0 })
  return response
}
