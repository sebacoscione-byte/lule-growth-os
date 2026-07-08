import type { SupabaseClient } from "@supabase/supabase-js"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem } from "@/types"

const CONTENT_KEY = "content_pipeline"
const SETTINGS_KEY = "auto_publish_settings"

const DEFAULT_TRACK: AutoPublishTrackSettings = {
  enabled: false,
  times_per_week: 2,
  days_of_week: [],
  starts_at: null,
  last_published_at: null,
  last_run_at: null,
  last_run_result: null,
}

export const DEFAULT_AUTO_PUBLISH_SETTINGS: AutoPublishSettings = {
  channels: ["instagram"],
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

/** Pura, sin I/O: true si el track tiene una fecha de inicio programada que todavia no llego. */
export function isScheduledForFuture(track: AutoPublishTrackSettings, now: Date): boolean {
  return Boolean(track.starts_at) && now.getTime() < new Date(track.starts_at as string).getTime()
}

/** Pura, sin I/O: true si "now" cae en uno de los dias de la semana elegidos para el track. */
export function isTodayScheduledDay(track: AutoPublishTrackSettings, now: Date): boolean {
  return track.days_of_week.includes(now.getDay())
}

/** Pura, sin I/O: true si ya se publico algo de este track el mismo dia calendario que "now" (evita duplicar si el cron corre mas de una vez el mismo dia). */
export function alreadyPublishedToday(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.last_published_at) return false
  return new Date(track.last_published_at).toDateString() === now.toDateString()
}

/** Pura, sin I/O: false si el track esta apagado, si la fecha de inicio programada no llego, si hoy no es uno de los dias elegidos, o si ya se publico hoy. */
export function shouldRunAutoPublish(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.enabled) return false
  if (isScheduledForFuture(track, now)) return false
  if (!isTodayScheduledDay(track, now)) return false
  return !alreadyPublishedToday(track, now)
}

/**
 * Pura, sin I/O: cuantos dias de calendario van a pasar hasta que se agote una cola de "count"
 * piezas, publicando una por cada dia elegido de la semana a partir de "now" (sin contar hoy).
 * Solo para mostrar una estimacion en la UI, no se usa para decidir cuando publicar.
 */
export function estimateAutoPublishDrainDays(count: number, daysOfWeek: number[], now: Date): number {
  if (count <= 0 || daysOfWeek.length === 0) return 0
  let published = 0
  let elapsedDays = 0
  const cursor = new Date(now)
  while (published < count && elapsedDays < 365) {
    cursor.setDate(cursor.getDate() + 1)
    elapsedDays++
    if (daysOfWeek.includes(cursor.getDay())) published++
  }
  return elapsedDays
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

/**
 * Pura, sin I/O: interseccion entre los canales pedidos por la pieza y los habilitados globalmente,
 * excluyendo los que ya se publicaron con exito antes (reintento tras una publicacion parcial no
 * debe volver a postear en el canal que ya salio bien).
 */
export function resolveChannelsToPublish(item: ContentItem, channels: ContentChannel[]): ContentChannel[] {
  return item.channels.filter(channel => channels.includes(channel) && item.auto_publish_result?.[channel] !== "published")
}
