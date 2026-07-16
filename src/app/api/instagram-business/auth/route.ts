import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  INSTAGRAM_OAUTH_COOKIE_MAX_AGE,
  INSTAGRAM_OAUTH_REDIRECT_COOKIE,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  createOauthState,
  getInstagramRedirectUri,
  isSecureRequest,
} from "@/lib/instagram-oauth"
import { authorizeStaff } from "@/lib/staff-authz"

const INSTAGRAM_OAUTH_ROLES = ["owner"] as const

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights", // requerido para Business Discovery (consultar datos publicos de otras cuentas)
].join(",")

export async function GET(request: NextRequest) {
  // Requiere sesión: sin esto, cualquiera con la URL podía iniciar el OAuth con su propia
  // cuenta de Instagram y reemplazar la conexión de Lucía (ver auditoría de seguridad 2026-07-07).
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: INSTAGRAM_OAUTH_ROLES, sensitive: true })
  if (!auth.ok) {
    const destination = auth.status === 401 ? "/login" : `/contenido/instagram?ig_error=${auth.code}`
    return NextResponse.redirect(new URL(destination, request.url))
  }

  const appId = process.env.INSTAGRAM_APP_ID
  const redirectUri = getInstagramRedirectUri(request)

  if (!appId) {
    return NextResponse.json({ error: "Instagram OAuth no está configurado" }, { status: 503 })
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
