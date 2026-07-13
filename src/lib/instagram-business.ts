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

/**
 * Cantidad de seguidores de la CUENTA PROPIA conectada. A diferencia de business_discovery (que
 * consulta OTRA cuenta y no existe en graph.instagram.com, ver getBusinessDiscovery), este es un
 * campo normal de la cuenta autenticada -- requiere el scope instagram_business_manage_insights
 * (ya cargado desde el 2026-07-10) pero no requiere ninguna Facebook Page vinculada.
 */
export async function getFollowerCount(token: string): Promise<number> {
  const url = `${GRAPH_BASE}/me?fields=followers_count&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const data = await res.json() as { followers_count?: number; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG followers_count error ${res.status}`)
  if (typeof data.followers_count !== "number") {
    throw new Error("La API de Instagram no devolvió followers_count para esta cuenta")
  }
  return data.followers_count
}

export type InstagramAccountInsightMetric =
  | "reach"
  | "profile_views"
  | "profile_links_taps"
  | "total_interactions"

export interface InstagramAccountInsights {
  reach: number | null
  profileViews: number | null
  linkTaps: number | null
  totalInteractions: number | null
}

interface InstagramInsightResponse {
  data?: Array<{
    values?: Array<{ value?: number }>
    total_value?: { value?: number }
  }>
  error?: { message?: string }
}

export function parseInstagramInsightValue(data: InstagramInsightResponse): number | null {
  const metric = data.data?.[0]
  const latestValue = metric?.values?.at(-1)?.value
  if (typeof latestValue === "number") return latestValue
  const totalValue = metric?.total_value?.value
  return typeof totalValue === "number" ? totalValue : null
}

async function getAccountInsightMetric(
  token: string,
  metric: InstagramAccountInsightMetric
): Promise<number | null> {
  const params = new URLSearchParams({
    metric,
    period: "day",
    access_token: token,
  })
  const res = await fetch(`${GRAPH_BASE}/me/insights?${params}`)
  const data = await res.json() as InstagramInsightResponse
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `IG account insights error ${res.status}`)
  }
  return parseInstagramInsightValue(data)
}

/**
 * Métricas diarias nativas de la cuenta profesional. Se consultan por separado porque Meta puede
 * no habilitar una métrica puntual (por tipo/tamaño de cuenta) sin que eso deba ocultar las demás.
 */
export async function getInstagramAccountInsights(token: string): Promise<InstagramAccountInsights> {
  const metrics: InstagramAccountInsightMetric[] = [
    "reach", "profile_views", "profile_links_taps", "total_interactions",
  ]
  const results = await Promise.all(metrics.map(async metric => {
    try {
      return await getAccountInsightMetric(token, metric)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[instagram-insights] metric=${metric}: ${message}`)
      return null
    }
  }))

  return {
    reach: results[0],
    profileViews: results[1],
    linkTaps: results[2],
    totalInteractions: results[3],
  }
}

interface BusinessDiscoveryData {
  username: string
  name?: string
  followers_count?: number
  media_count?: number
  biography?: string
  website?: string
  profile_picture_url?: string
}

/**
 * Consulta datos publicos de OTRA cuenta Instagram Business/Creator (no la conectada) por
 * username. Requiere el scope instagram_business_manage_insights en el token conectado.
 */
export async function getBusinessDiscovery(token: string, username: string): Promise<BusinessDiscoveryData> {
  const fields = `business_discovery.username(${username}){username,name,followers_count,media_count,biography,website,profile_picture_url}`
  const url = `${GRAPH_BASE}/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const data = await res.json() as { business_discovery?: BusinessDiscoveryData; error?: { message: string } }
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG business discovery error ${res.status}`)
  if (!data.business_discovery) throw new Error(`No se encontro la cuenta @${username} o no es una cuenta Business/Creator`)
  return data.business_discovery
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

export async function waitForContainerReady(token: string, containerId: string, timeoutMs = 40_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getContainerStatus(token, containerId)
    if (status === "FINISHED") return
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`IG container status: ${status}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error("Tiempo de espera agotado procesando la imagen en Instagram")
}

const PUBLISHABLE_FORMATS = ["post", "historia"] as const

function parseImageDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } {
  const match = /^data:(image\/(png|jpe?g));base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error("La placa generada no tiene un formato de imagen valido (PNG o JPEG).")
  const [, contentType, subtype, base64] = match
  return { buffer: Buffer.from(base64, "base64"), contentType, extension: subtype === "jpeg" ? "jpg" : subtype }
}

/**
 * Sube la placa a Storage y publica en Instagram (post o historia). Parametrizada por SupabaseClient
 * para poder llamarse tanto desde una ruta con sesion de usuario como desde el cron (service role).
 */
export async function publishImageToInstagram(
  supabase: SupabaseClient,
  input: { itemId: string; imageDataUrl?: string; imageUrl?: string; caption?: string; format: string }
): Promise<{ mediaId: string }> {
  if (!PUBLISHABLE_FORMATS.includes(input.format as typeof PUBLISHABLE_FORMATS[number])) {
    throw new Error("Esta funcion solo publica posts o historias (una imagen). Los reels requieren video real -- usa Copiar Instagram. Los carruseles usan publishCarouselToInstagram.")
  }

  const token = await getValidToken(supabase)
  if (!token) throw new Error("Instagram no esta conectado. Conectá la cuenta primero.")

  // Si ya tenemos una placa persistida (subida al generarla), reusamos esa URL sin volver a subir nada.
  let imageUrl = input.imageUrl
  if (!imageUrl) {
    if (!input.imageDataUrl) throw new Error("Falta la placa generada o el identificador del contenido.")
    const { buffer, contentType, extension } = parseImageDataUrl(input.imageDataUrl)
    const path = `${input.itemId}-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from("content-media")
      .upload(path, buffer, { contentType, upsert: true })
    if (uploadError) throw new Error(`No se pudo subir la imagen: ${uploadError.message}`)

    const { data: publicUrlData } = supabase.storage.from("content-media").getPublicUrl(path)
    imageUrl = publicUrlData.publicUrl
  }

  const asStory = input.format === "historia"
  const containerId = await createImageContainer(token, imageUrl, {
    asStory,
    caption: asStory ? undefined : (input.caption ?? "").slice(0, 2200),
  })
  await waitForContainerReady(token, containerId)
  const mediaId = await publishContainer(token, containerId)
  return { mediaId }
}

// ─── Publicacion (carrusel) ─────────────────────────────────────────────────

const CAROUSEL_MIN_ITEMS = 2
const CAROUSEL_MAX_ITEMS = 10

export async function createCarouselItemContainer(token: string, imageUrl: string): Promise<string> {
  const params = new URLSearchParams({ image_url: imageUrl, is_carousel_item: "true", access_token: token })
  const res = await fetch(`${GRAPH_BASE}/me/media?${params}`, { method: "POST" })
  const data = await res.json() as ContainerResponse
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG carousel item error ${res.status}`)
  return data.id
}

export async function createCarouselContainer(token: string, childIds: string[], caption?: string): Promise<string> {
  const params = new URLSearchParams({ media_type: "CAROUSEL", children: childIds.join(","), access_token: token })
  if (caption) params.set("caption", caption)
  const res = await fetch(`${GRAPH_BASE}/me/media?${params}`, { method: "POST" })
  const data = await res.json() as ContainerResponse
  if (!res.ok || data.error) throw new Error(data.error?.message || `IG carousel container error ${res.status}`)
  return data.id
}

/**
 * Publica un carrusel: cada imagen ya tiene que estar generada y persistida en Storage de antes (el
 * flujo de aprobacion de una pieza "carrusel" exige portada + todas las slides con su propia placa,
 * ver /api/content/items PATCH) -- a diferencia de publishImageToInstagram, esta funcion nunca sube
 * un data URL nuevo, solo trabaja con URLs publicas ya existentes.
 */
export async function publishCarouselToInstagram(
  supabase: SupabaseClient,
  input: { imageUrls: string[]; caption?: string }
): Promise<{ mediaId: string }> {
  if (input.imageUrls.length < CAROUSEL_MIN_ITEMS) {
    throw new Error(`Un carrusel necesita al menos ${CAROUSEL_MIN_ITEMS} imagenes generadas (portada + al menos una slide).`)
  }
  if (input.imageUrls.length > CAROUSEL_MAX_ITEMS) {
    throw new Error(`Instagram no permite mas de ${CAROUSEL_MAX_ITEMS} imagenes en un carrusel.`)
  }

  const token = await getValidToken(supabase)
  if (!token) throw new Error("Instagram no esta conectado. Conectá la cuenta primero.")

  // En paralelo: cada child container es independiente, y esperar de a uno (hasta 40s cada uno) podria
  // superar el maxDuration del cron con carruseles de varias imagenes. Promise.all preserva el orden.
  const childIds = await Promise.all(input.imageUrls.map(async imageUrl => {
    const childId = await createCarouselItemContainer(token, imageUrl)
    await waitForContainerReady(token, childId)
    return childId
  }))

  const carouselContainerId = await createCarouselContainer(token, childIds, (input.caption ?? "").slice(0, 2200))
  await waitForContainerReady(token, carouselContainerId)
  const mediaId = await publishContainer(token, carouselContainerId)
  return { mediaId }
}
