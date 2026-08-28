import type {
  ContentItem,
  ContentObjective,
  InstagramInsightWindow,
  InstagramMediaInsightSnapshot,
} from "@/types"

export type ContentLocationKey =
  | "cimel"
  | "swiss"
  | "britanico_lanus"
  | "britanico_central"
  | "britanico"
  | "sin_atribuir"

export interface ContentAttributionMetrics {
  visits: number
  clicks: number
  whatsappClicks: number
  conversations: number
  leads: number
  confirmed: number
}

export interface ContentAttributionAggregateRow {
  item_id: string
  location_key: string | null
  visits: number | string
  clicks: number | string
  whatsapp_clicks: number | string
  conversations: number | string
  leads: number | string
  confirmed: number | string
}

export interface ContentPerformanceRow {
  itemId: string
  topic: string
  format: ContentItem["format"]
  category: string
  objective: ContentObjective
  publishedAt: string
  weekday: number
  hour: number
  slotLabel: string
  windows: Partial<Record<InstagramInsightWindow, InstagramMediaInsightSnapshot>>
  attribution: ContentAttributionMetrics
  attributionByLocation: Partial<Record<ContentLocationKey, ContentAttributionMetrics>>
}

export interface ContentStrategyRecommendation {
  key: string
  summary: string
  metric: "patient_signals_per_1000" | "saves_shares_per_1000"
  evidence: {
    format: ContentItem["format"]
    objective: ContentObjective
    betterSlot: string
    comparisonSlot: string
    betterPieces: number
    comparisonPieces: number
    betterRate: number
    comparisonRate: number
  }
  status?: "pending" | "approved" | "dismissed"
}

const EMPTY_METRICS: ContentAttributionMetrics = {
  visits: 0,
  clicks: 0,
  whatsappClicks: 0,
  conversations: 0,
  leads: 0,
  confirmed: 0,
}

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

function number(value: number | string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function addMetrics(left: ContentAttributionMetrics, right: ContentAttributionMetrics) {
  return {
    visits: left.visits + right.visits,
    clicks: left.clicks + right.clicks,
    whatsappClicks: left.whatsappClicks + right.whatsappClicks,
    conversations: left.conversations + right.conversations,
    leads: left.leads + right.leads,
    confirmed: left.confirmed + right.confirmed,
  }
}

export function getArgentinePublishSlot(isoDate: string): { weekday: number; hour: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(isoDate))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(entry => entry.type === type)?.value)
  const year = part("year")
  const month = part("month")
  const day = part("day")
  const hour = part("hour") % 24
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { weekday, hour, label: `${DAY_LABELS[weekday]} ${hour}–${(hour + 1) % 24}` }
}

export function buildContentPerformanceRows(
  items: ContentItem[],
  windowsByItem: Record<string, Partial<Record<InstagramInsightWindow, InstagramMediaInsightSnapshot>>>,
  attributionRows: ContentAttributionAggregateRow[],
): ContentPerformanceRow[] {
  const totals = new Map<string, ContentAttributionMetrics>()
  const byLocation = new Map<string, Partial<Record<ContentLocationKey, ContentAttributionMetrics>>>()

  for (const raw of attributionRows) {
    const metrics: ContentAttributionMetrics = {
      visits: number(raw.visits),
      clicks: number(raw.clicks),
      whatsappClicks: number(raw.whatsapp_clicks),
      conversations: number(raw.conversations),
      leads: number(raw.leads),
      confirmed: number(raw.confirmed),
    }
    totals.set(raw.item_id, addMetrics(totals.get(raw.item_id) ?? EMPTY_METRICS, metrics))
    const location = raw.location_key === "cimel"
      || raw.location_key === "swiss"
      || raw.location_key === "britanico_lanus"
      || raw.location_key === "britanico_central"
      || raw.location_key === "britanico"
      ? raw.location_key
      : "sin_atribuir"
    const itemLocations = byLocation.get(raw.item_id) ?? {}
    itemLocations[location] = addMetrics(itemLocations[location] ?? EMPTY_METRICS, metrics)
    byLocation.set(raw.item_id, itemLocations)
  }

  return items.flatMap(item => {
    const publishedAt = item.published_at ?? item.manual_publish_note?.marked_at
    if (item.status !== "published" || !publishedAt) return []
    const slot = getArgentinePublishSlot(publishedAt)
    return [{
      itemId: item.id,
      topic: item.topic,
      format: item.format,
      category: item.category,
      objective: item.objective ?? "conversion",
      publishedAt,
      weekday: slot.weekday,
      hour: slot.hour,
      slotLabel: slot.label,
      windows: windowsByItem[item.id] ?? {},
      attribution: totals.get(item.id) ?? { ...EMPTY_METRICS },
      attributionByLocation: byLocation.get(item.id) ?? {},
    } satisfies ContentPerformanceRow]
  }).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
}

export function metricsForLocation(
  row: ContentPerformanceRow,
  location: "all" | Exclude<ContentLocationKey, "sin_atribuir">,
): ContentAttributionMetrics {
  if (location === "all") return row.attribution
  const locationMetrics = row.attributionByLocation[location] ?? EMPTY_METRICS
  // Una visita llega a la pieza/landing antes de que la persona elija sede; no se inventa un
  // reparto por ubicación. Se conserva el total de visitas y se filtran las etapas posteriores.
  return { ...locationMetrics, visits: row.attribution.visits }
}

export function perThousand(value: number | null | undefined, reach: number | null | undefined): number | null {
  if (value == null || reach == null || reach <= 0) return null
  return Math.round((value / reach) * 1_000 * 10) / 10
}

export function buildContentStrategyRecommendations(
  rows: ContentPerformanceRow[],
): ContentStrategyRecommendation[] {
  const cohorts = new Map<string, ContentPerformanceRow[]>()
  for (const row of rows) {
    const snapshot = row.windows["7d"]
    if (!snapshot || snapshot.reach == null || snapshot.reach <= 0) continue
    const key = `${row.format}:${row.objective}`
    cohorts.set(key, [...(cohorts.get(key) ?? []), row])
  }

  const recommendations: ContentStrategyRecommendation[] = []
  for (const cohort of cohorts.values()) {
    const slots = new Map<string, ContentPerformanceRow[]>()
    for (const row of cohort) slots.set(row.slotLabel, [...(slots.get(row.slotLabel) ?? []), row])
    const comparable = [...slots.entries()].filter(([, items]) => items.length >= 3)
    if (comparable.length < 2) continue

    const hasPatientSignals = comparable.some(([, items]) => items.some(item => (
      item.attribution.conversations + item.attribution.leads + item.attribution.confirmed
    ) > 0))
    const metric: ContentStrategyRecommendation["metric"] = hasPatientSignals
      ? "patient_signals_per_1000"
      : "saves_shares_per_1000"
    const scored = comparable.map(([slot, items]) => {
      const totalReach = items.reduce((sum, item) => sum + (item.windows["7d"]?.reach ?? 0), 0)
      const totalValue = items.reduce((sum, item) => {
        if (metric === "patient_signals_per_1000") {
          return sum + item.attribution.conversations + item.attribution.leads * 2 + item.attribution.confirmed * 4
        }
        const snapshot = item.windows["7d"]
        return sum + (snapshot?.saved ?? 0) + (snapshot?.shares ?? 0)
      }, 0)
      return { slot, items, rate: totalReach > 0 ? (totalValue / totalReach) * 1_000 : 0 }
    }).sort((left, right) => right.rate - left.rate)

    const [better, comparison] = scored
    if (!better || !comparison || better.rate <= 0 || better.rate < comparison.rate * 1.1) continue
    const first = better.items[0]
    const metricLabel = metric === "patient_signals_per_1000"
      ? "señales de consulta por 1.000 alcanzados"
      : "guardados y compartidos por 1.000 alcanzados"
    recommendations.push({
      key: `${first.format}:${first.objective}:${better.slot}:${comparison.slot}:${metric}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-"),
      summary: `Las piezas ${first.format} de ${first.objective} en ${better.slot} obtuvieron más ${metricLabel} que en ${comparison.slot}. Hay ${better.items.length} y ${comparison.items.length} piezas comparables. Se recomienda probar dos publicaciones adicionales en ${better.slot}.`,
      metric,
      evidence: {
        format: first.format,
        objective: first.objective,
        betterSlot: better.slot,
        comparisonSlot: comparison.slot,
        betterPieces: better.items.length,
        comparisonPieces: comparison.items.length,
        betterRate: Math.round(better.rate * 10) / 10,
        comparisonRate: Math.round(comparison.rate * 10) / 10,
      },
      status: "pending",
    })
  }
  return recommendations
}
