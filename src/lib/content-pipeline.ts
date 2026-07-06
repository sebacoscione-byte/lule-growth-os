import type { SupabaseClient } from "@supabase/supabase-js"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem } from "@/types"

const CONTENT_KEY = "content_pipeline"
const SETTINGS_KEY = "auto_publish_settings"

const DEFAULT_TRACK: AutoPublishTrackSettings = {
  enabled: false,
  times_per_week: 2,
  last_published_at: null,
  last_run_at: null,
  last_run_result: null,
}

export const DEFAULT_AUTO_PUBLISH_SETTINGS: AutoPublishSettings = {
  channels: ["instagram", "google_business"],
  post: { ...DEFAULT_TRACK, times_per_week: 2 },
  historia: { ...DEFAULT_TRACK, times_per_week: 3 },
}

export async function readContentItems(supabase: SupabaseClient): Promise<ContentItem[]> {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", CONTENT_KEY)
    .maybeSingle()
  if (error) throw error
  return Array.isArray(data?.value) ? data.value as ContentItem[] : []
}

export async function writeContentItems(supabase: SupabaseClient, items: ContentItem[]): Promise<void> {
  const { error } = await supabase
    .from("app_config")
    .upsert({ key: CONTENT_KEY, value: items }, { onConflict: "key" })
  if (error) throw error
}

export async function readAutoPublishSettings(supabase: SupabaseClient): Promise<AutoPublishSettings> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle()
  const stored = data?.value as Partial<AutoPublishSettings> | undefined

  // Forma vieja (cronograma unico, sin .post/.historia): nunca se llego a activar en produccion
  // (enabled seguia en false), asi que reseteamos directo a los defaults nuevos en vez de migrar.
  if (!stored?.post || !stored?.historia) return DEFAULT_AUTO_PUBLISH_SETTINGS

  return {
    channels: stored.channels ?? DEFAULT_AUTO_PUBLISH_SETTINGS.channels,
    post: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, ...stored.post },
    historia: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.historia, ...stored.historia },
  }
}

export async function writeAutoPublishSettings(supabase: SupabaseClient, settings: AutoPublishSettings): Promise<void> {
  const { error } = await supabase
    .from("app_config")
    .upsert({ key: SETTINGS_KEY, value: settings }, { onConflict: "key" })
  if (error) throw error
}

/** Pura, sin I/O: false si el track esta apagado o si todavia no paso el intervalo (7 / veces_por_semana) desde la ultima publicacion. */
export function shouldRunAutoPublish(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.enabled) return false
  if (!track.last_published_at) return true
  const elapsedMs = now.getTime() - new Date(track.last_published_at).getTime()
  const intervalDays = 7 / track.times_per_week
  return elapsedMs >= intervalDays * 24 * 60 * 60 * 1000
}

/**
 * Pura, sin I/O: elige el proximo item para auto-publicar de un formato puntual (post u historia,
 * cada uno con su propio cronograma). FIFO por approved_at entre los aprobados de ese formato.
 */
export function pickNextPublishableItem(items: ContentItem[], format: "post" | "historia"): ContentItem | null {
  const candidates = items
    .filter(item => item.status === "approved" && item.format === format)
    .sort((a, b) => new Date(a.approved_at ?? a.created_at).getTime() - new Date(b.approved_at ?? b.created_at).getTime())
  return candidates[0] ?? null
}

/** Pura, sin I/O: interseccion entre los canales pedidos por la pieza y los habilitados globalmente. */
export function resolveChannelsToPublish(item: ContentItem, channels: ContentChannel[]): ContentChannel[] {
  return item.channels.filter(channel => channels.includes(channel))
}
