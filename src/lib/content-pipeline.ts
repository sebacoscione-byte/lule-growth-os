import type { SupabaseClient } from "@supabase/supabase-js"
import type { AutoPublishSettings, ContentItem } from "@/types"

const CONTENT_KEY = "content_pipeline"
const SETTINGS_KEY = "auto_publish_settings"

export const DEFAULT_AUTO_PUBLISH_SETTINGS: AutoPublishSettings = {
  enabled: false,
  interval_days: 3,
  channels: ["instagram", "google_business"],
  last_published_at: null,
  last_run_at: null,
  last_run_result: null,
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
  return { ...DEFAULT_AUTO_PUBLISH_SETTINGS, ...(data?.value as Partial<AutoPublishSettings> | undefined) }
}

export async function writeAutoPublishSettings(supabase: SupabaseClient, settings: AutoPublishSettings): Promise<void> {
  const { error } = await supabase
    .from("app_config")
    .upsert({ key: SETTINGS_KEY, value: settings }, { onConflict: "key" })
  if (error) throw error
}

/** Pura, sin I/O: false si esta apagado o si todavia no paso el intervalo desde la ultima publicacion. */
export function shouldRunAutoPublish(settings: AutoPublishSettings, now: Date): boolean {
  if (!settings.enabled) return false
  if (!settings.last_published_at) return true
  const elapsedMs = now.getTime() - new Date(settings.last_published_at).getTime()
  return elapsedMs >= settings.interval_days * 24 * 60 * 60 * 1000
}

const AUTO_PUBLISHABLE_FORMATS = ["post", "historia"] as const

/**
 * Pura, sin I/O: elige el proximo item para auto-publicar. FIFO por approved_at entre los
 * aprobados publicables por API (reel/carrusel quedan para accion manual, ver /docs/CONTENT_STUDIO.md).
 */
export function pickNextPublishableItem(items: ContentItem[]): ContentItem | null {
  const candidates = items
    .filter(item => item.status === "approved" && AUTO_PUBLISHABLE_FORMATS.includes(item.format as typeof AUTO_PUBLISHABLE_FORMATS[number]))
    .sort((a, b) => new Date(a.approved_at ?? a.created_at).getTime() - new Date(b.approved_at ?? b.created_at).getTime())
  return candidates[0] ?? null
}

/** Pura, sin I/O: interseccion entre los canales pedidos por la pieza y los habilitados globalmente. */
export function resolveChannelsToPublish(item: ContentItem, settings: AutoPublishSettings) {
  return item.channels.filter(channel => settings.channels.includes(channel))
}
