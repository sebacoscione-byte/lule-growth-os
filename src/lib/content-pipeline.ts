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
  carrusel: { ...DEFAULT_TRACK, times_per_week: 1 },
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

  // .carrusel es nuevo (2026-07-11): las configuraciones ya guardadas en produccion no lo tienen.
  // Nunca resetear post/historia por esto -- solo completar carrusel con el default (deshabilitado).
  return {
    channels: stored.channels ?? DEFAULT_AUTO_PUBLISH_SETTINGS.channels,
    post: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, ...stored.post },
    historia: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.historia, ...stored.historia },
    carrusel: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.carrusel, ...(stored.carrusel ?? {}) },
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
 * de la semana a partir de "now". Si "todayAvailable" es true y hoy es uno de los dias elegidos, hoy
 * mismo cuenta como la primera ocurrencia (offset 0) — pasa a false cuando ya se publico hoy o el
 * track todavia no arranco (ver "todayAvailable" en los callers de abajo).
 */
function nthScheduledDayOffset(n: number, daysOfWeek: number[], now: Date, todayAvailable: boolean = true): number {
  if (n <= 0 || daysOfWeek.length === 0) return 0
  let found = 0
  let elapsedDays = 0
  const cursor = new Date(now)
  if (todayAvailable && daysOfWeek.includes(cursor.getDay())) found++
  while (found < n && elapsedDays < 400) {
    cursor.setDate(cursor.getDate() + 1)
    elapsedDays++
    if (daysOfWeek.includes(cursor.getDay())) found++
  }
  return elapsedDays
}

/**
 * Pura, sin I/O: cuantos dias de calendario van a pasar hasta que se agote una cola de "count"
 * piezas, publicando hasta "itemsPerRun" por cada dia elegido de la semana a partir de "now" (hoy
 * cuenta si "todayAvailable" es true, ver `nthScheduledDayOffset`). Solo para mostrar una estimacion
 * en la UI, no se usa para decidir cuando publicar.
 */
export function estimateAutoPublishDrainDays(
  count: number, daysOfWeek: number[], itemsPerRun: number, now: Date, todayAvailable: boolean = true
): number {
  if (count <= 0) return 0
  const runsNeeded = Math.ceil(count / Math.max(1, itemsPerRun))
  return nthScheduledDayOffset(runsNeeded, daysOfWeek, now, todayAvailable)
}

/**
 * Pura, sin I/O: fecha estimada en que saldria publicada la pieza que ocupa la posicion "position"
 * (1-indexado) de la cola, dado cuantas piezas se publican por corrida. null si no hay ningun dia
 * de la semana elegido todavia (no hay forma de estimar). "todayAvailable" en false excluye hoy como
 * candidato (ya se publico hoy, o el track todavia no arranco) — ver `nthScheduledDayOffset`.
 */
export function estimateAutoPublishDateForPosition(
  position: number, daysOfWeek: number[], itemsPerRun: number, now: Date, todayAvailable: boolean = true
): Date | null {
  if (position <= 0 || daysOfWeek.length === 0) return null
  const runsNeeded = Math.ceil(position / Math.max(1, itemsPerRun))
  const offsetDays = nthScheduledDayOffset(runsNeeded, daysOfWeek, now, todayAvailable)
  const result = new Date(now)
  result.setDate(result.getDate() + offsetDays)
  return result
}

/**
 * Pura, sin I/O: fecha estimada de la ULTIMA publicacion de una pieza evergreen con limite de
 * repeticiones (`repeat_limit`), segun los dias del cronograma. null si no tiene limite (no deja de
 * publicarse hasta apagarla) o si ya no le quedan repeticiones. Modelo: la pieza aparece
 * `1 + repeat_limit` veces en total (la publicacion original + N repeticiones); ya aparecio
 * `(publicada ? 1 : 0) + repeat_count` veces. La ultima cae en el n-esimo dia programado que falta
 * (una aparicion por dia programado, por eso itemsPerRun = 1). Es una estimacion para la UI.
 */
export function estimateRepeatEndDate(
  item: ContentItem, daysOfWeek: number[], now: Date, todayAvailable: boolean = true
): Date | null {
  if (!item.repeat_interval_days || item.repeat_interval_days <= 0) return null
  if (item.repeat_limit == null) return null
  const totalAppearances = 1 + item.repeat_limit
  const appearancesSoFar = (item.status === "published" ? 1 : 0) + (item.repeat_count ?? 0)
  const remaining = Math.max(0, totalAppearances - appearancesSoFar)
  if (remaining <= 0) return null
  return estimateAutoPublishDateForPosition(remaining, daysOfWeek, 1, now, todayAvailable)
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
 * Pura, sin I/O: una pieza evergreen (`repeat_interval_days` seteado) ya publicada vuelve a estar
 * disponible cuando pasaron al menos esos dias desde su ultima publicacion (`updated_at` se pisa
 * en cada publicacion, ver `publishApprovedItem`).
 */
export function isRepeatDue(item: ContentItem, now: Date): boolean {
  if (item.status !== "published") return false
  if (!item.repeat_interval_days || item.repeat_interval_days <= 0) return false
  // Limite opcional de repeticiones: al alcanzarlo, la pieza deja de repetirse sola (queda publicada
  // en su ultima salida). null/undefined = sin limite.
  if (item.repeat_limit != null && (item.repeat_count ?? 0) >= item.repeat_limit) return false
  const daysSinceLastPublish = (now.getTime() - new Date(item.updated_at).getTime()) / (1000 * 60 * 60 * 24)
  return daysSinceLastPublish >= item.repeat_interval_days
}

/** Formatos con cronograma propio de auto-publicacion. Reel queda afuera: requiere video real, no soportado. */
export type AutoPublishFormat = "post" | "historia" | "carrusel"

/**
 * Pura, sin I/O: elige que items auto-publicar de un formato puntual (post, historia o carrusel, cada
 * uno con su propio cronograma). `count` (items_per_run) limita SOLO las piezas nuevas aprobadas
 * (contenido fresco, ordenadas por `effectiveQueueRank`). Las piezas evergreen que ya cumplieron su
 * intervalo de repeticion (ver `isRepeatDue`) se publican ADEMAS, sin competir por ese cupo: una pieza
 * fija que se repite no le quita el lugar a una nueva -- salen las dos en la misma corrida. Las evergreen
 * van ordenadas por la mas atrasada.
 */
export function pickNextPublishableItems(
  items: ContentItem[],
  format: AutoPublishFormat,
  count: number,
  now: Date = new Date()
): ContentItem[] {
  const approved = items
    .filter(item => item.status === "approved" && item.format === format)
    .sort((a, b) => effectiveQueueRank(a) - effectiveQueueRank(b))
  const dueRepeats = items
    .filter(item => item.format === format && isRepeatDue(item, now))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
  return [...approved.slice(0, Math.max(0, count)), ...dueRepeats]
}

/** Pura, sin I/O: elige el proximo item para auto-publicar de un formato puntual. Ver `pickNextPublishableItems`. */
export function pickNextPublishableItem(items: ContentItem[], format: AutoPublishFormat): ContentItem | null {
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

const DEFAULT_DUPLICATE_TOPIC_WINDOW_DAYS = 30

function normalizeForComparison(text: string): string {
  return text.trim().toLocaleLowerCase("es")
}

/**
 * Pura, sin I/O: la pieza mas reciente con la misma categoria o el mismo hook (comparacion exacta,
 * sin mayusculas/espacios) generada dentro de la ventana de dias hacia atras desde "now", para avisar
 * antes de repetir un tema o un gancho reciente. Ignora piezas archivadas (ya descartadas a proposito)
 * y, si se pasa el id de la pieza que se esta editando, se ignora a si misma.
 */
export function findRecentDuplicateTopic(
  items: ContentItem[],
  candidate: { id?: string; category: string; hook?: string },
  now: Date = new Date(),
  windowDays: number = DEFAULT_DUPLICATE_TOPIC_WINDOW_DAYS
): ContentItem | null {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const normalizedCategory = normalizeForComparison(candidate.category)
  const normalizedHook = normalizeForComparison(candidate.hook ?? "")

  const matches = items.filter(item => {
    if (item.status === "archived") return false
    if (candidate.id && item.id === candidate.id) return false
    if (new Date(item.created_at).getTime() < cutoff) return false
    const sameCategory = normalizedCategory.length > 0 && normalizeForComparison(item.category) === normalizedCategory
    const sameHook = normalizedHook.length > 0 && normalizeForComparison(item.hook) === normalizedHook
    return sameCategory || sameHook
  })
  if (matches.length === 0) return null
  return matches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
}

/**
 * Pura, sin I/O: interseccion entre los canales pedidos por la pieza y los habilitados globalmente,
 * excluyendo los que ya se publicaron con exito antes (reintento tras una publicacion parcial no
 * debe volver a postear en el canal que ya salio bien).
 */
export function resolveChannelsToPublish(item: ContentItem, channels: ContentChannel[]): ContentChannel[] {
  return item.channels.filter(channel => channels.includes(channel) && item.auto_publish_result?.[channel] !== "published")
}
