import type { SupabaseClient } from "@supabase/supabase-js"

// "Instagram API with Instagram Login": no requiere una Facebook Page vinculada,
// solo una cuenta de Instagram profesional (Business o Creator).
const OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token"
const GRAPH_BASE = "https://graph.instagram.com"
const LONG_LIVED_MIN_AGE_MS = 24 * 60 * 60 * 1000 // Meta exige >24h antes de poder refrescar

// ─── Token management (guardados en app_config, mismo patron que Google) ────

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch(OAUTH_TOKEN_URL, { method: "POST", body })
  if (!res.ok) throw new Error(`Instagram token exchange failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; user_id: string }>
}

export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    access_token: shortLivedToken,
  })
  const res = await fetch(`${GRAPH_BASE}/access_token?${params}`)
  if (!res.ok) throw new Error(`Instagram long-lived exchange failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; token_type: string; expires_in: number }>
}

async function refreshLongLivedToken(accessToken: string) {
  const params = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken })
  const res = await fetch(`${GRAPH_BASE}/refresh_access_token?${params}`)
  if (!res.ok) throw new Error(`Instagram token refresh failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; token_type: string; expires_in: number }>
}

export async function saveTokens(
  supabase: SupabaseClient,
  tokens: { access_token: string; expires_in: number; user_id: string; issued_at?: number }
) {
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  const issuedAt = new Date(tokens.issued_at ?? Date.now()).toISOString()
  await Promise.all([
    supabase.from("app_config").upsert({ key: "instagram_access_token", value: tokens.access_token }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "instagram_user_id", value: tokens.user_id }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "instagram_token_expires_at", value: expiry }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "instagram_token_issued_at", value: issuedAt }, { onConflict: "key" }),
  ])
}

export async function getConnectionInfo(supabase: SupabaseClient) {
  const keys = ["instagram_access_token", "instagram_user_id", "instagram_username"]
  const { data } = await supabase.from("app_config").select("key, value").in("key", keys)
  if (!data?.length) return null

  const map: Record<string, string> = {}
  data.forEach((r: { key: string; value: unknown }) => { map[r.key] = r.value as string })

  if (!map.instagram_access_token) return null
  return map
}

export async function getValidToken(supabase: SupabaseClient): Promise<string | null> {
  const keys = ["instagram_access_token", "instagram_token_expires_at", "instagram_token_issued_at"]
  const { data } = await supabase.from("app_config").select("key, value").in("key", keys)
  if (!data?.length) return null

  const map: Record<string, string> = {}
  data.forEach((r: { key: string; value: unknown }) => { map[r.key] = r.value as string })
  if (!map.instagram_access_token) return null

  const expiresAt = map.instagram_token_expires_at ? new Date(map.instagram_token_expires_at).getTime() : 0
  const issuedAt = map.instagram_token_issued_at ? new Date(map.instagram_token_issued_at).getTime() : 0
  const oldEnoughToRefresh = Date.now() - issuedAt > LONG_LIVED_MIN_AGE_MS
  const nearExpiry = Date.now() > expiresAt - 3 * 24 * 60 * 60 * 1000 // refrescar con 3 dias de margen

  if (!nearExpiry) return map.instagram_access_token
  if (!oldEnoughToRefresh) return map.instagram_access_token // aun no se puede refrescar, pero sigue valido

  const fresh = await refreshLongLivedToken(map.instagram_access_token)
  const newExpiry = new Date(Date.now() + fresh.expires_in * 1000).toISOString()
  await Promise.all([
    supabase.from("app_config").upsert({ key: "instagram_access_token", value: fresh.access_token }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "instagram_token_expires_at", value: newExpiry }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "instagram_token_issued_at", value: new Date().toISOString() }, { onConflict: "key" }),
  ])
  return fresh.access_token
}

export async function clearTokens(supabase: SupabaseClient) {
  const keys = [
    "instagram_access_token", "instagram_user_id", "instagram_username",
    "instagram_token_expires_at", "instagram_token_issued_at",
  ]
  await supabase.from("app_config").delete().in("key", keys)
}

// ─── Perfil ───────────────────────────────────────────────────────────────

export async function getProfile(token: string) {
  const url = `${GRAPH_BASE}/me?fields=id,username&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ id: string; username: string }>
}

// ─── Publicacion (feed image post o story) ─────────────────────────────────

interface ContainerResponse { id: string; error?: { message: string } }

export async function createImageContainer(
  token: string,
  imageUrl: string,
  options: { caption?: string; asStory?: boolean }
): Promise<string> {
  const params = new URLSearchParams({ image_url: imageUrl, access_token: token })
  if (options.asStory) params.set("media_type", "STORIES")
  else if (options.caption) params.set("caption", options.caption)

  const res = await fetch(`${GRAPH_BASE}/me/media?${params}`, { method: "POST" })
  const data = await res.json() as ContainerResponse
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG container error ${res.status}`)
  return data.id
}

export async function getContainerStatus(token: string, containerId: string): Promise<string> {
  const url = `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const data = await res.json() as { status_code?: string; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG status error ${res.status}`)
  return data.status_code ?? "UNKNOWN"
}

export async function publishContainer(token: string, containerId: string): Promise<string> {
  const params = new URLSearchParams({ creation_id: containerId, access_token: token })
  const res = await fetch(`${GRAPH_BASE}/me/media_publish?${params}`, { method: "POST" })
  const data = await res.json() as ContainerResponse
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG publish error ${res.status}`)
  return data.id
}

export async function waitForContainerReady(token: string, containerId: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getContainerStatus(token, containerId)
    if (status === "FINISHED") return
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`IG container status: ${status}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error("Tiempo de espera agotado procesando la imagen en Instagram")
}
