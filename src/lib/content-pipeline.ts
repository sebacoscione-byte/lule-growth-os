import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem } from "@/types"

const CONTENT_KEY = "content_pipeline"
const SETTINGS_KEY = "auto_publish_settings"

export const AUTO_PUBLISH_TIMEZONE = "America/Argentina/Buenos_Aires" as const
export const AUTO_PUBLISH_WINDOW_BY_FORMAT = {
  post: "19:00",
  historia: "18:00",
  carrusel: "19:00",
  reel: "19:00",
} as const

function defaultTrack(dayOfWeek: number[], localTime: string): AutoPublishTrackSettings {
  return {
    enabled: false,
    timezone: AUTO_PUBLISH_TIMEZONE,
    schedule_slots: dayOfWeek.map(day => ({ day_of_week: day, local_time: localTime })),
    items_per_run: 1,
    starts_at: null,
    last_published_at: null,
    last_run_at: null,
    last_run_result: null,
  }
}

export const DEFAULT_AUTO_PUBLISH_SETTINGS: AutoPublishSettings = {
  channels: ["instagram"],
  // Cadencia inicial de agosto 2026. Queda preparada pero apagada: activarla siempre es una
  // decisión explícita del owner desde la UI.
  post: defaultTrack([4], AUTO_PUBLISH_WINDOW_BY_FORMAT.post),
  historia: defaultTrack([1, 2, 4, 6, 0], AUTO_PUBLISH_WINDOW_BY_FORMAT.historia),
  carrusel: defaultTrack([1, 0], AUTO_PUBLISH_WINDOW_BY_FORMAT.carrusel),
  reel: defaultTrack([6], AUTO_PUBLISH_WINDOW_BY_FORMAT.reel),
}

const slotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict()

function trackSchema(expectedLocalTime: string, maxItemsPerRun: number) {
  return z.object({
    enabled: z.boolean(),
    timezone: z.literal(AUTO_PUBLISH_TIMEZONE),
    schedule_slots: z.array(slotSchema).max(7).superRefine((slots, context) => {
      const seen = new Set<number>()
      for (const [index, slot] of slots.entries()) {
        if (seen.has(slot.day_of_week)) {
          context.addIssue({ code: "custom", path: [index, "day_of_week"], message: "No puede haber dos slots el mismo día." })
        }
        seen.add(slot.day_of_week)
        if (slot.local_time !== expectedLocalTime) {
          context.addIssue({
            code: "custom",
            path: [index, "local_time"],
            message: `La infraestructura actual admite la ventana ${expectedLocalTime} ART para este formato.`,
          })
        }
      }
    }),
    items_per_run: z.number().int().min(1).max(maxItemsPerRun),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    last_published_at: z.string().datetime({ offset: true }).nullable(),
    last_run_at: z.string().datetime({ offset: true }).nullable(),
    last_run_result: z.string().max(1000).nullable(),
  }).strict()
}

export const autoPublishSettingsSchema = z.object({
  channels: z.array(z.enum(["instagram", "google_business"])).min(1),
  post: trackSchema(AUTO_PUBLISH_WINDOW_BY_FORMAT.post, 1),
  historia: trackSchema(AUTO_PUBLISH_WINDOW_BY_FORMAT.historia, 10),
  carrusel: trackSchema(AUTO_PUBLISH_WINDOW_BY_FORMAT.carrusel, 1),
  reel: trackSchema(AUTO_PUBLISH_WINDOW_BY_FORMAT.reel, 1),
}).strict().superRefine((settings, context) => {
  const occupied = new Map<number, string>()
  for (const format of ["post", "carrusel", "reel"] as const) {
    if (!settings[format].enabled) continue
    for (const [index, slot] of settings[format].schedule_slots.entries()) {
      const previous = occupied.get(slot.day_of_week)
      if (previous) {
        context.addIssue({
          code: "custom",
          path: [format, "schedule_slots", index, "day_of_week"],
          message: `Ya hay una pieza principal de ${previous} esa noche.`,
        })
      } else {
        occupied.set(slot.day_of_week, format)
      }
    }
  }
})

type LegacyTrack = Partial<AutoPublishTrackSettings> & {
  days_of_week?: unknown
  times_per_week?: unknown
}

function normalizeTrack(
  raw: LegacyTrack | null | undefined,
  fallback: AutoPublishTrackSettings,
  expectedLocalTime: string
): AutoPublishTrackSettings {
  if (!raw || typeof raw !== "object") return { ...fallback, schedule_slots: [...fallback.schedule_slots] }

  let scheduleSlots = fallback.schedule_slots
  if (Object.prototype.hasOwnProperty.call(raw, "schedule_slots")) {
    scheduleSlots = Array.isArray(raw.schedule_slots)
      ? raw.schedule_slots.flatMap(slot => {
          const parsed = slotSchema.safeParse(slot)
          return parsed.success && parsed.data.local_time === expectedLocalTime ? [parsed.data] : []
        })
      : []
  } else if (Array.isArray(raw.days_of_week)) {
    scheduleSlots = [...new Set(raw.days_of_week)]
      .filter((day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)
      .map(day => ({ day_of_week: day, local_time: expectedLocalTime }))
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    timezone: AUTO_PUBLISH_TIMEZONE,
    schedule_slots: scheduleSlots,
    items_per_run: Number.isInteger(raw.items_per_run) && Number(raw.items_per_run) >= 1
      ? Math.min(Number(raw.items_per_run), expectedLocalTime === AUTO_PUBLISH_WINDOW_BY_FORMAT.historia ? 10 : 1)
      : fallback.items_per_run,
    starts_at: typeof raw.starts_at === "string" || raw.starts_at === null ? raw.starts_at : fallback.starts_at,
    last_published_at: typeof raw.last_published_at === "string" || raw.last_published_at === null
      ? raw.last_published_at : fallback.last_published_at,
    last_run_at: typeof raw.last_run_at === "string" || raw.last_run_at === null ? raw.last_run_at : fallback.last_run_at,
    last_run_result: typeof raw.last_run_result === "string" || raw.last_run_result === null
      ? raw.last_run_result : fallback.last_run_result,
  }
}

export function normalizeAutoPublishSettings(value: unknown): AutoPublishSettings {
  const stored = value && typeof value === "object" ? value as Partial<AutoPublishSettings> : {}
  const channels = Array.isArray(stored.channels)
    ? stored.channels.filter((channel): channel is ContentChannel => channel === "instagram" || channel === "google_business")
    : DEFAULT_AUTO_PUBLISH_SETTINGS.channels
  return {
    channels: channels.length > 0 ? [...new Set(channels)] : DEFAULT_AUTO_PUBLISH_SETTINGS.channels,
    post: normalizeTrack(stored.post as LegacyTrack | undefined, DEFAULT_AUTO_PUBLISH_SETTINGS.post, AUTO_PUBLISH_WINDOW_BY_FORMAT.post),
    historia: normalizeTrack(stored.historia as LegacyTrack | undefined, DEFAULT_AUTO_PUBLISH_SETTINGS.historia, AUTO_PUBLISH_WINDOW_BY_FORMAT.historia),
    carrusel: normalizeTrack(stored.carrusel as LegacyTrack | undefined, DEFAULT_AUTO_PUBLISH_SETTINGS.carrusel, AUTO_PUBLISH_WINDOW_BY_FORMAT.carrusel),
    reel: normalizeTrack(stored.reel as LegacyTrack | undefined, DEFAULT_AUTO_PUBLISH_SETTINGS.reel, AUTO_PUBLISH_WINDOW_BY_FORMAT.reel),
  }
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
  return normalizeAutoPublishSettings(data?.value)
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

export interface ZonedScheduleParts {
  dateKey: string
  dayOfWeek: number
  hour: number
  minute: number
}

/** Convierte un instante UTC a las partes de calendario usadas por el cron editorial argentino. */
export function getZonedScheduleParts(
  date: Date,
  timezone: AutoPublishTrackSettings["timezone"] = AUTO_PUBLISH_TIMEZONE
): ZonedScheduleParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value])
  )
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

export function getScheduledDays(track: AutoPublishTrackSettings): number[] {
  return [...new Set(track.schedule_slots.map(slot => slot.day_of_week))]
}

function localTimeMinutes(localTime: string): number {
  const [hour, minute] = localTime.split(":").map(Number)
  return hour * 60 + minute
}

/** Vercel Hobby dispara dentro de la hora configurada; cada slot representa esa ventana de 60 minutos. */
export function isWithinScheduledWindow(track: AutoPublishTrackSettings, now: Date): boolean {
  const local = getZonedScheduleParts(now, track.timezone)
  const currentMinutes = local.hour * 60 + local.minute
  return track.schedule_slots.some(slot => {
    if (slot.day_of_week !== local.dayOfWeek) return false
    const start = localTimeMinutes(slot.local_time)
    return currentMinutes >= start && currentMinutes < start + 60
  })
}

/** Pura, sin I/O: true si "now" cae en uno de los días locales elegidos para el track. */
export function isTodayScheduledDay(track: AutoPublishTrackSettings, now: Date): boolean {
  return getScheduledDays(track).includes(getZonedScheduleParts(now, track.timezone).dayOfWeek)
}

/** Pura, sin I/O: true si ya se publicó algo el mismo día argentino (evita duplicar un reintento). */
export function alreadyPublishedToday(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.last_published_at) return false
  return getZonedScheduleParts(new Date(track.last_published_at), track.timezone).dateKey
    === getZonedScheduleParts(now, track.timezone).dateKey
}

/** Pura, sin I/O: exige estado, fecha, slot local vigente y ausencia de una publicación previa ese día. */
export function shouldRunAutoPublish(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.enabled) return false
  if (isScheduledForFuture(track, now)) return false
  if (!isWithinScheduledWindow(track, now)) return false
  return !alreadyPublishedToday(track, now)
}

/** Para estimaciones de UI: hoy cuenta si la ventana todavía no terminó y no se publicó. */
export function canStillPublishToday(track: AutoPublishTrackSettings, now: Date): boolean {
  if (!track.enabled || isScheduledForFuture(track, now) || alreadyPublishedToday(track, now)) return false
  const local = getZonedScheduleParts(now, track.timezone)
  const currentMinutes = local.hour * 60 + local.minute
  return track.schedule_slots.some(slot =>
    slot.day_of_week === local.dayOfWeek && currentMinutes < localTimeMinutes(slot.local_time) + 60
  )
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
  const startingDay = getZonedScheduleParts(now).dayOfWeek
  if (todayAvailable && daysOfWeek.includes(startingDay)) found++
  while (found < n && elapsedDays < 400) {
    elapsedDays++
    if (daysOfWeek.includes((startingDay + elapsedDays) % 7)) found++
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
  const local = getZonedScheduleParts(now)
  const [year, month, day] = local.dateKey.split("-").map(Number)
  // Mediodía UTC mantiene la fecha civil estable para ART y evita que la zona del navegador/servidor
  // cambie el día mostrado al sumar offsets de calendario.
  return new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0))
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

// Offset usado como fallback de orden para una pieza evergreen (publicada, en repeticion) que nunca
// se reordeno a mano: muy por encima de cualquier timestamp real, para que por default siga cayendo
// despues de las piezas aprobadas nuevas (mismo comportamiento de siempre), pero permite que un
// queue_rank manual la intercale en cualquier lugar de la cola una vez que se la reordena.
const REPEAT_DEFAULT_RANK_OFFSET = 10_000_000_000_000

/**
 * Orden efectivo dentro de la cola de un formato: `queue_rank` explicito (asignado al reordenar a
 * mano) tiene prioridad; si nunca se reordeno, se ordena por approved_at (FIFO, el de siempre) para
 * una pieza aprobada, o por "la mas atrasada primero" (con el offset de arriba) para una evergreen ya
 * publicada. Los ranks manuales son enteros chicos (1, 2, 3...) y los fallbacks son numeros mucho mas
 * grandes, asi que una pieza reordenada a mano siempre queda antes que una que nunca se toco.
 */
function effectiveQueueRank(item: ContentItem): number {
  if (item.queue_rank != null) return item.queue_rank
  if (item.status === "published" && item.repeat_interval_days) {
    return REPEAT_DEFAULT_RANK_OFFSET + new Date(item.updated_at).getTime()
  }
  return new Date(item.approved_at ?? item.created_at).getTime()
}

/**
 * Pura, sin I/O: si una pieza puede reordenarse a mano dentro de la cola de su formato -- una
 * aprobada (de siempre) o una ya publicada que sigue repitiendose de verdad (con intervalo activo y,
 * si tiene limite, sin haberlo alcanzado todavia). Se usa tanto para decidir que piezas se mueven
 * juntas al reordenar como para mostrar las flechas de orden en la Biblioteca.
 */
export function isReorderableInQueue(item: ContentItem): boolean {
  if (item.status === "approved") return true
  if (item.status === "published" && item.repeat_interval_days && item.repeat_interval_days > 0) {
    return item.repeat_limit == null || (item.repeat_count ?? 0) < item.repeat_limit
  }
  return false
}

/**
 * Pura, sin I/O: posicion (1-indexada) de cada pieza reordenable (aprobada o evergreen repitiendose)
 * dentro de la cola de su propio formato, segun el orden efectivo actual. A diferencia del "#N en la
 * cola" que ve una pieza aprobada (que cuenta solo piezas nuevas, ver `pickNextPublishableItems`),
 * esta posicion sirve para mostrarle a una pieza evergreen en que lugar de la tanda quedaria -- y que
 * las flechas de reordenar tengan un numero visible que confirme que el cambio se aplico.
 */
export function reorderableQueuePositions(items: ContentItem[], format: AutoPublishFormat): Map<string, number> {
  const ordered = items
    .filter(item => isReorderableInQueue(item) && item.format === format)
    .sort((a, b) => effectiveQueueRank(a) - effectiveQueueRank(b))
  return new Map(ordered.map((queuedItem, index) => [queuedItem.id, index + 1]))
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

/** Formatos con cronograma propio de auto-publicacion. Reel (2026-07-23) requiere que el video ya este
 * subido a mano en el item (video_url) -- la app no genera video, ver publishReelToInstagram. */
export type AutoPublishFormat = "post" | "historia" | "carrusel" | "reel"

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
  const dueRepeats = items.filter(item => item.format === format && isRepeatDue(item, now))
  // Orden final por queue_rank efectivo: por default una evergreen sigue cayendo despues de las
  // piezas nuevas (mismo comportamiento de siempre, ver REPEAT_DEFAULT_RANK_OFFSET), pero si se la
  // reordeno a mano (mismas flechas que ya existian para la cola aprobada, ver moveItemInQueue) puede
  // intercalarse en cualquier lugar -- esto determina el orden real de publicacion de la corrida (ej.
  // el orden en que unas Historias quedan una detras de otra para quien las mira).
  return [...approved.slice(0, Math.max(0, count)), ...dueRepeats]
    .sort((a, b) => effectiveQueueRank(a) - effectiveQueueRank(b))
}

/** Pura, sin I/O: elige el proximo item para auto-publicar de un formato puntual. Ver `pickNextPublishableItems`. */
export function pickNextPublishableItem(items: ContentItem[], format: AutoPublishFormat): ContentItem | null {
  return pickNextPublishableItems(items, format, 1)[0] ?? null
}

/**
 * Pura, sin I/O: mueve una pieza reordenable (aprobada, o evergreen ya publicada y repitiendose, ver
 * `isReorderableInQueue`) un lugar hacia arriba o abajo dentro de la cola de su propio formato. Al
 * mover, normaliza `queue_rank` de TODA esa cola (aprobadas + evergreens activas) a enteros
 * secuenciales segun el orden efectivo actual (esto "migra" piezas viejas sin queue_rank al nuevo
 * sistema explicito) y despues intercambia el rank de las dos piezas afectadas -- asi una evergreen
 * puede intercalarse en cualquier lugar entre las piezas nuevas, en vez de salir siempre al final de
 * la corrida. Si la pieza ya esta en la punta de la cola en esa direccion, no hace nada.
 */
export function moveItemInQueue(items: ContentItem[], id: string, direction: "up" | "down"): ContentItem[] {
  const target = items.find(item => item.id === id)
  if (!target || !isReorderableInQueue(target)) return items

  const queueIds = items
    .filter(item => isReorderableInQueue(item) && item.format === target.format)
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

const DEFAULT_DUPLICATE_TOPIC_WINDOW_DAYS = 15

function normalizeForComparison(text: string): string {
  return text.trim().toLocaleLowerCase("es")
}

/**
 * Pura, sin I/O: la pieza mas reciente con la misma categoria o el mismo hook (comparacion exacta,
 * sin mayusculas/espacios) generada dentro de la ventana de dias hacia atras desde "now", para avisar
 * antes de repetir un tema o un gancho reciente. Solo considera piezas aprobadas o publicadas (un
 * borrador todavia puede descartarse o cambiar de tema, no es una repeticion real todavia) y, si se
 * pasa el id de la pieza que se esta editando, se ignora a si misma.
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
    if (item.status !== "approved" && item.status !== "published") return false
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
