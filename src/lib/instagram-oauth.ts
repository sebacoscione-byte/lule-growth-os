import { randomBytes } from "crypto"
import type { NextRequest } from "next/server"

export const INSTAGRAM_OAUTH_STATE_COOKIE = "instagram_oauth_state"
export const INSTAGRAM_OAUTH_REDIRECT_COOKIE = "instagram_oauth_redirect_uri"
export const INSTAGRAM_OAUTH_COOKIE_MAX_AGE = 10 * 60

export function createOauthState() {
  return randomBytes(32).toString("base64url")
}

export function getInstagramRedirectUri(request: NextRequest) {
  const configuredBaseUrl = process.env.INSTAGRAM_OAUTH_BASE_URL?.trim()
  const origin = configuredBaseUrl || request.nextUrl.origin
  return new URL("/api/instagram-business/callback", origin).toString()
}

export function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:"
}
