import type { SupabaseClient } from "@supabase/supabase-js"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem } from "@/types"

const CONTENT_KEY = "content_pipeline"
const SETTINGS_KEY = "auto_publish_settings"

const DEFAULT_TRACK: AutoPublishTrackSettings = {
  enabled: false,
  times_per_week: 2,
  days_of_week: [],
  items_per_run: 1,
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
 * Pura, sin I/O: cuantos dias de calendario van a pasar hasta que corra el n-esimo dia programado
 * de la semana a partir de "now" (sin contar hoy). Base compartida por las dos estimaciones de abajo.
 */
function nthScheduledDayOffset(n: number, daysOfWeek: number[], now: Date): number {
  if (n <= 0 || daysOfWeek.length === 0) return 0
  let found = 0
  let elapsedDays = 0
  const cursor = new Date(now)
  while (found < n && elapsedDays < 400) {
    cursor.setDate(cursor.getDate() + 1)
    elapsedDays++
    if (daysOfWeek.includes(cursor.getDay())) found++
  }
  return elapsedDays
}

/**
 * Pura, sin I/O: cuantos dias de calendario van a pasar hasta que se agote una cola de "count"
 * piezas, publicando hasta "itemsPerRun" por cada dia elegido de la semana a partir de "now" (sin
 * contar hoy). Solo para mostrar una estimacion en la UI, no se usa para decidir cuando publicar.
 */
export function estimateAutoPublishDrainDays(count: number, daysOfWeek: number[], itemsPerRun: number, now: Date): number {
  if (count <= 0) return 0
  const runsNeeded = Math.ceil(count / Math.max(1, itemsPerRun))
  return nthScheduledDayOffset(runsNeeded, daysOfWeek, now)
}

/**
 * Pura, sin I/O: fecha estimada en que saldria publicada la pieza que ocupa la posicion "position"
 * (1-indexado) de la cola, dado cuantas piezas se publican por corrida. null si no hay ningun dia
 * de la semana elegido todavia (no hay forma de estimar).
 */
export function estimateAutoPublishDateForPosition(
  position: number, daysOfWeek: number[], itemsPerRun: number, now: Date
): Date | null {
  if (position <= 0 || daysOfWeek.length === 0) return null
  const runsNeeded = Math.ceil(position / Math.max(1, itemsPerRun))
  const offsetDays = nthScheduledDayOffset(runsNeeded, daysOfWeek, now)
  const result = new Date(now)
  result.setDate(result.getDate() + offsetDays)
  return result
}

/**
 * Orden efectivo dentro de la cola de un formato: `queue_rank` explicito (asignado al reordenar a
 * mano) tiene prioridad; si nunca se reordeno, se ordena por approved_at (FIFO, el de siempre). Los
 * ranks manuales son enteros chicos (1, 2, 3...) y los timestamps son numeros mucho mas grandes, asi
 * que una pieza reordenada a mano siempre queda antes que una que nunca se toco.
 */
function effectiveQueueRank(item: ContentItem): number {
  return item.queue_rank ?? new Date(item.approved_at ?? item.created_at).getTime()
}

/**
 * Pura, sin I/O: elige hasta "count" items para auto-publicar de un formato puntual (post u historia,
 * cada uno con su propio cronograma), en el orden de `effectiveQueueRank`.
 */
export function pickNextPublishableItems(items: ContentItem[], format: "post" | "historia", count: number): ContentItem[] {
  return items
    .filter(item => item.status === "approved" && item.format === format)
    .sort((a, b) => effectiveQueueRank(a) - effectiveQueueRank(b))
    .slice(0, Math.max(0, count))
}

/** Pura, sin I/O: elige el proximo item para auto-publicar de un formato puntual. Ver `pickNextPublishableItems`. */
export function pickNextPublishableItem(items: ContentItem[], format: "post" | "historia"): ContentItem | null {
  return pickNextPublishableItems(items, format, 1)[0] ?? null
}

/**
 * Pura, sin I/O: mueve una pieza aprobada un lugar hacia arriba o abajo dentro de la cola de su
 * propio formato. Al mover, normaliza `queue_rank` de TODA la cola de ese formato a enteros
 * secuenciales segun el orden efectivo actual (esto "migra" piezas viejas sin queue_rank al nuevo
 * sistema explicito) y despues intercambia el rank de las dos piezas afectadas. Si la pieza ya esta
 * en la punta de la cola en esa direccion, no hace nada.
 */
export function moveItemInQueue(items: ContentItem[], id: string, direction: "up" | "down"): ContentItem[] {
  const target = items.find(item => item.id === id)
  if (!target || target.status !== "approved") return items

  const queueIds = items
    .filter(item => item.status === "approved" && item.format === target.format)
    .sort((a, b) => effectiveQueueRank(a) - effectiveQueueRank(b))
    .map(item => item.id)

  const index = queueIds.indexOf(id)
  const swapIndex = direction === "up" ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= queueIds.length) return items

  const ranks = new Map(queueIds.map((itemId, position) => [itemId, position + 1]))
  const a = queueIds[index]
  const b = queueIds[swapIndex]
  const rankA = ranks.get(a) as number
  const rankB = ranks.get(b) as number
  ranks.set(a, rankB)
  ranks.set(b, rankA)

  return items.map(item => ranks.has(item.id) ? { ...item, queue_rank: ranks.get(item.id) as number } : item)
}

/**
 * Pura, sin I/O: interseccion entre los canales pedidos por la pieza y los habilitados globalmente,
 * excluyendo los que ya se publicaron con exito antes (reintento tras una publicacion parcial no
 * debe volver a postear en el canal que ya salio bien).
 */
export function resolveChannelsToPublish(item: ContentItem, channels: ContentChannel[]): ContentChannel[] {
  return item.channels.filter(channel => channels.includes(channel) && item.auto_publish_result?.[channel] !== "published")
}
