import type { SupabaseClient } from "@supabase/supabase-js"

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1"
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1"
const LEGACY_API = "https://mybusiness.googleapis.com/v4"
const TOKEN_URL = "https://oauth2.googleapis.com/token"

// ─── Token management ────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function getValidToken(supabase: SupabaseClient): Promise<string | null> {
  const keys = ["google_access_token", "google_refresh_token", "google_token_expires_at"]
  const { data } = await supabase.from("app_config").select("key, value").in("key", keys)
  if (!data?.length) return null

  const map: Record<string, string> = {}
  data.forEach((r: { key: string; value: unknown }) => { map[r.key] = r.value as string })

  if (!map.google_refresh_token) return null

  const expiresAt = new Date(map.google_token_expires_at)
  const isExpired = !map.google_access_token || Date.now() > expiresAt.getTime() - 60_000

  if (!isExpired) return map.google_access_token

  const fresh = await refreshAccessToken(map.google_refresh_token)
  const newExpiry = new Date(Date.now() + fresh.expires_in * 1000).toISOString()

  await Promise.all([
    supabase.from("app_config").upsert({ key: "google_access_token", value: fresh.access_token }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_token_expires_at", value: newExpiry }, { onConflict: "key" }),
  ])

  return fresh.access_token
}

export async function getConnectionInfo(supabase: SupabaseClient) {
  const keys = ["google_refresh_token", "google_account_id", "google_location_id", "google_location_name", "google_account_name"]
  const { data } = await supabase.from("app_config").select("key, value").in("key", keys)
  if (!data?.length) return null

  const map: Record<string, string> = {}
  data.forEach((r: { key: string; value: unknown }) => { map[r.key] = r.value as string })

  if (!map.google_refresh_token) return null
  return map
}

export async function saveTokens(supabase: SupabaseClient, tokens: {
  access_token: string
  refresh_token: string
  expires_in: number
}) {
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await Promise.all([
    supabase.from("app_config").upsert({ key: "google_access_token", value: tokens.access_token }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_refresh_token", value: tokens.refresh_token }, { onConflict: "key" }),
    supabase.from("app_config").upsert({ key: "google_token_expires_at", value: expiry }, { onConflict: "key" }),
  ])
}

export async function clearTokens(supabase: SupabaseClient) {
  const keys = ["google_access_token", "google_refresh_token", "google_token_expires_at", "google_account_id", "google_location_id", "google_account_name", "google_location_name"]
  await supabase.from("app_config").delete().in("key", keys)
}

// ─── Account & Location discovery ────────────────────────────────────────────

export async function listAccounts(token: string) {
  const res = await fetch(`${ACCOUNTS_API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json() as { accounts?: Array<{ name: string; accountName: string; type: string }> }
  return data
}

export async function listLocations(token: string, accountName: string) {
  const url = `${INFO_API}/${accountName}/locations?readMask=name,title`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json() as { locations?: Array<{ name: string; title?: string }> }
  return {
    locations: (data.locations ?? []).map(l => ({
      name: l.name,
      title: l.title ?? l.name,
    }))
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface GoogleLocationProfile {
  name?: string
  title?: string
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string }
  regularHours?: { periods?: Array<{ openDay: string; openTime: unknown; closeTime: unknown }> }
  phoneNumbers?: { primaryPhone?: string }
  websiteUri?: string
  profile?: { description?: string }
}

export async function getLocation(token: string, locationName: string): Promise<GoogleLocationProfile> {
  const url = `${INFO_API}/${locationName}?readMask=name,title,storefrontAddress,regularHours,phoneNumbers,websiteUri,profile`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<GoogleLocationProfile>
}

// ─── Checklist auto-detection ─────────────────────────────────────────────────

/**
 * Subconjunto de items del checklist de Google Local que se pueden verificar leyendo el perfil
 * real (Business Information API), en vez de depender de que alguien los tilde a mano. El resto
 * de los items (Q&A, fotos, categorías, etc.) no tiene API pública de Google o requiere una API
 * separada con la misma restricción de cuota que ya bloquea "listar cuentas" para esta cuenta —
 * quedan manuales.
 */
export const AUTO_CHECKLIST_KEYS = [
  "nombre_correcto",
  "descripcion_cargada",
  "horario_real",
  "link_landing",
  "telefono_configurado",
] as const

const ACCENTS: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n" }

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[áéíóúñ]/g, c => ACCENTS[c] ?? c)
}

export function computeChecklistAutoStatus(location: GoogleLocationProfile): Record<string, boolean> {
  const title = normalizeText(location.title ?? "")
  const keywordStuffing = ["cardiolog", "consultorio", "clinica", "cimel", "turno", "medic"]

  return {
    nombre_correcto: title.includes("lucia chahin") && !keywordStuffing.some(k => title.includes(k)),
    descripcion_cargada: Boolean(location.profile?.description && location.profile.description.trim().length > 20),
    horario_real: Boolean(location.regularHours?.periods?.some(p => p.openDay === "TUESDAY")),
    link_landing: Boolean(location.websiteUri?.includes("dra-lucia-chahin")),
    telefono_configurado: Boolean(location.phoneNumbers?.primaryPhone?.trim()),
  }
}

export async function updateDescription(token: string, locationName: string, description: string) {
  const url = `${INFO_API}/${locationName}?updateMask=profile.description`
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ profile: { description } }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateWebsite(token: string, locationName: string, websiteUri: string) {
  const url = `${INFO_API}/${locationName}?updateMask=websiteUri`
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ websiteUri }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updatePhone(token: string, locationName: string, primaryPhone: string) {
  const url = `${INFO_API}/${locationName}?updateMask=phoneNumbers`
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumbers: { primaryPhone } }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export interface HourPeriod {
  openDay: string
  openTime: string  // "HH:MM"
  closeTime: string // "HH:MM"
}

export async function updateHours(token: string, locationName: string, periods: HourPeriod[]) {
  const url = `${INFO_API}/${locationName}?updateMask=regularHours`
  const body = {
    regularHours: {
      periods: periods.map(p => ({
        openDay: p.openDay,
        openTime: { hours: parseInt(p.openTime.split(":")[0]), minutes: parseInt(p.openTime.split(":")[1]) },
        closeTime: { hours: parseInt(p.closeTime.split(":")[0]), minutes: parseInt(p.closeTime.split(":")[1]) },
      })),
    },
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Posts (legacy v4 API) ────────────────────────────────────────────────────

export async function listPosts(token: string, accountId: string, locationId: string) {
  const url = `${LEGACY_API}/accounts/${accountId}/locations/${locationId}/localPosts`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{
    localPosts?: Array<{
      name: string
      summary: string
      state: string
      createTime: string
      updateTime: string
    }>
  }>
}

export async function createPost(token: string, accountId: string, locationId: string, summary: string) {
  const url = `${LEGACY_API}/accounts/${accountId}/locations/${locationId}/localPosts`
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ languageCode: "es", summary, topicType: "STANDARD" }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

/**
 * Resuelve conexion/token y publica un post de texto en Google Business. Parametrizada por
 * SupabaseClient para poder llamarse tanto desde una ruta con sesion de usuario como desde el cron
 * (service role) — misma logica que ya usaba /api/google-business/posts, ahora reutilizable.
 */
export async function createGoogleBusinessPost(supabase: SupabaseClient, input: { summary: string }) {
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    throw new Error("Falta Account ID. Google no lo expone en algunas cuentas; publica desde el panel oficial hasta que la API permita descubrirlo.")
  }

  const token = await getValidToken(supabase)
  if (!token) throw new Error("Token expired")

  return createPost(token, info.google_account_id, info.google_location_id, input.summary)
}

export async function deletePost(token: string, accountId: string, locationId: string, postId: string) {
  const url = `${LEGACY_API}/accounts/${accountId}/locations/${locationId}/localPosts/${postId}`
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Reviews (legacy v4 API) ──────────────────────────────────────────────────

export async function listReviews(token: string, accountId: string, locationId: string) {
  const url = `${LEGACY_API}/accounts/${accountId}/locations/${locationId}/reviews?orderBy=updateTime desc&pageSize=20`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{
    reviews?: Array<{
      name: string
      reviewId: string
      reviewer: { profilePhotoUrl: string; displayName: string; isAnonymous: boolean }
      starRating: string
      comment?: string
      createTime: string
      updateTime: string
      reviewReply?: { comment: string; updateTime: string }
    }>
  }>
}

export async function replyToReview(token: string, accountId: string, locationId: string, reviewId: string, comment: string) {
  const url = `${LEGACY_API}/accounts/${accountId}/locations/${locationId}/reviews/${reviewId}/reply`
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
