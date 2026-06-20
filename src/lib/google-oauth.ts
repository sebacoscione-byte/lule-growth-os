import { createHash, randomBytes } from "crypto"
import type { NextRequest } from "next/server"

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state"
export const GOOGLE_OAUTH_VERIFIER_COOKIE = "google_oauth_code_verifier"
export const GOOGLE_OAUTH_REDIRECT_COOKIE = "google_oauth_redirect_uri"
export const GOOGLE_OAUTH_COOKIE_MAX_AGE = 10 * 60

export function createOauthState() {
  return randomBytes(32).toString("base64url")
}

export function createPkcePair() {
  const verifier = randomBytes(64).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function getGoogleRedirectUri(request: NextRequest) {
  const configuredBaseUrl = process.env.GOOGLE_OAUTH_BASE_URL?.trim()
  const origin = configuredBaseUrl || request.nextUrl.origin
  return new URL("/api/google-business/callback", origin).toString()
}

export function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:"
}
