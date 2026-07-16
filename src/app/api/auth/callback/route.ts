import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { getMfaAccessDecision, safeMfaNextPath } from "@/lib/staff-mfa"
import { PUBLIC_SITE_ORIGIN } from "@/lib/tracked-links"

function trustedCallbackOrigin(requestUrl: string): string {
  const requested = new URL(requestUrl)
  if (
    process.env.NODE_ENV !== "production"
    && (requested.hostname === "localhost" || requested.hostname === "127.0.0.1")
  ) {
    return requested.origin
  }

  const vercelHost = process.env.VERCEL_URL
  if (
    process.env.VERCEL_ENV === "preview"
    && vercelHost
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.vercel\.app$/i.test(vercelHost)
  ) {
    return `https://${vercelHost}`
  }
  return PUBLIC_SITE_ORIGIN
}

function loginError(origin: string, code: string): NextResponse {
  const url = new URL("/login", origin)
  url.searchParams.set("error", code)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = trustedCallbackOrigin(request.url)
  const code = searchParams.get("code")
  const next = safeMfaNextPath(searchParams.get("next"))

  if (!code) return loginError(origin, "auth_callback")

  const supabase = await createClient()
  const exchanged = await supabase.auth.exchangeCodeForSession(code)
  if (exchanged.error) return loginError(origin, "auth_callback")

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const decision = getMfaAccessDecision(
    assurance.data
      ? { currentLevel: assurance.data.currentLevel, nextLevel: assurance.data.nextLevel }
      : null
  )
  if (assurance.error || decision === "unavailable") {
    await supabase.auth.signOut({ scope: "local" })
    return loginError(origin, "security_check")
  }

  if (decision === "step_up") {
    const mfaUrl = new URL("/seguridad/mfa", origin)
    mfaUrl.searchParams.set("next", next)
    return NextResponse.redirect(mfaUrl)
  }

  return NextResponse.redirect(new URL(next, origin))
}
