import {
  canStillPublishToday,
  estimateAutoPublishDateForPosition,
  estimateAutoPublishDrainDays,
  getScheduledDays,
  getZonedScheduleParts,
} from "@/lib/content-pipeline"
import type { AutoPublishTrackSettings } from "@/types"
import { WEEKDAY_OPTIONS } from "@/types"

export function isFutureStart(track: AutoPublishTrackSettings): boolean {
  return Boolean(track.starts_at) && new Date(track.starts_at as string).getTime() > Date.now()
}

export function isTodayAvailableForQueueEstimate(track: AutoPublishTrackSettings, now: Date): boolean {
  return canStillPublishToday(track, now)
}

export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}

export function describeAutoPublishQueue(
  kind: "post" | "historia" | "carrusel" | "reel",
  count: number,
  track: AutoPublishTrackSettings,
  now: Date = new Date()
): string {
  const daysOfWeek = getScheduledDays(track)
  const { items_per_run: itemsPerRun } = track
  const label = kind === "post"
    ? `${count} post${count === 1 ? "" : "s"} aprobado${count === 1 ? "" : "s"} en cola`
    : kind === "historia"
      ? `${count} historia${count === 1 ? "" : "s"} aprobada${count === 1 ? "" : "s"} en cola`
      : kind === "carrusel"
        ? `${count} carrusel${count === 1 ? "" : "es"} aprobado${count === 1 ? "" : "s"} en cola`
        : `${count} reel${count === 1 ? "" : "s"} aprobado${count === 1 ? "" : "s"} en cola`
  if (count === 0) return `${label}.`
  if (daysOfWeek.length === 0) return `${label} — elegí al menos un día de la semana para que empiece a publicar.`
  const days = estimateAutoPublishDrainDays(count, daysOfWeek, itemsPerRun, now, isTodayAvailableForQueueEstimate(track, now))
  const article = kind === "historia" ? "la última saldría" : "el último saldría"
  const batch = itemsPerRun > 1 ? ` (publicando de a ${itemsPerRun})` : ""
  const daysLabel = days === 0 ? "hoy" : days === 1 ? "en aproximadamente 1 día" : `en unos ${days} días`
  return `${label} — a este ritmo${batch}, ${article} ${daysLabel}.`
}

export function describeWeekdaySelection(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 0) return ""
  const labels = WEEKDAY_OPTIONS.filter(option => daysOfWeek.includes(option.day)).map(option => option.label)
  return `Publica: ${labels.join(", ")}.`
}

export function describeWindow(track: AutoPublishTrackSettings): string {
  const start = track.schedule_slots[0]?.local_time
  if (!start) return "Sin horario configurado"
  const [hour] = start.split(":").map(Number)
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`
  return `Entre ${start} y ${end} ART`
}

export function describeNextWindow(track: AutoPublishTrackSettings, now: Date = new Date()): string {
  if (!track.enabled) return "Próxima ventana: activá este formato para calcularla."
  const days = getScheduledDays(track)
  if (days.length === 0) return "Próxima ventana: elegí al menos un día."
  const date = estimateAutoPublishDateForPosition(1, days, 1, now, canStillPublishToday(track, now))
  if (!date) return "Próxima ventana: no disponible."
  const localDay = getZonedScheduleParts(date, track.timezone).dayOfWeek
  const slot = track.schedule_slots.find(candidate => candidate.day_of_week === localDay) ?? track.schedule_slots[0]
  const [hour] = slot.local_time.split(":").map(Number)
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`
  const dayLabel = date.toLocaleDateString("es-AR", {
    timeZone: track.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return `Próxima ventana estimada: ${dayLabel}, entre ${slot.local_time} y ${end} ART.`
}

function describeAutoPublishIssue(issue: string): string {
  if (issue === "quota_exceeded") return "se alcanzó el límite diario de generación de imágenes con IA"
  if (issue.startsWith("error:")) return `hubo un error (${issue.replace(/^error:\s*/, "")})`
  return issue
}

export function describeLastAutoPublishRun(track: AutoPublishTrackSettings): string | null {
  if (!track.last_run_at) return null
  const when = new Date(track.last_run_at).toLocaleString("es-AR", { timeZone: track.timezone })
  const reasonMap: Record<string, string> = {
    skipped_disabled: "estaba apagada",
    skipped_scheduled: "todavía no llegó la fecha de inicio programada",
    skipped_no_slots: "no elegiste ningún día para este cronograma",
    skipped_interval: "la configuración anterior no tenía una ventana elegible en esa corrida",
    skipped_not_scheduled_day: "hoy no es uno de los días elegidos",
    skipped_outside_window: "la corrida llegó fuera de la ventana configurada",
    skipped_already_published: "ya se había publicado una pieza de este formato ese día",
    skipped_feed_conflict: "ya se había publicado otra pieza principal de feed esa noche",
    skipped_no_item: "no había ninguna pieza aprobada lista para publicar",
  }
  const result = track.last_run_result ?? ""
  const publishedMatch = result.match(/^published:(\d+)\/(\d+)(?:\s*\((.+)\))?$/)
  let readable = reasonMap[result]
  if (!readable && publishedMatch) {
    const [, doneStr, totalStr, issue] = publishedMatch
    const done = Number(doneStr)
    const total = Number(totalStr)
    if (done === total) {
      readable = total === 1 ? "se publicó correctamente" : `se publicaron las ${total} piezas correctamente`
    } else if (done === 0) {
      readable = total === 1
        ? "no se pudo publicar (revisá el detalle de la pieza)"
        : `no se pudo publicar ninguna de las ${total} piezas (revisá el detalle de cada una)`
    } else {
      readable = `se publicaron ${done} de ${total} piezas (revisá el detalle de las que fallaron)`
    }
    if (issue) readable += ` — motivo: ${describeAutoPublishIssue(issue)}`
  }
  return `Último intento: ${when} — ${readable ?? result}`
}
