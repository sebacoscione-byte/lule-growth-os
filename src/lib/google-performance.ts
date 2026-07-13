import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectionInfo, getValidToken } from "@/lib/google-business"
import { getGooglePlaceReviews } from "@/lib/google-places"

const PERFORMANCE_API = "https://businessprofileperformance.googleapis.com/v1"
const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
] as const

type GooglePerformanceStatus = "available" | "quota_blocked" | "not_connected" | "error"

export interface GooglePerformanceDay {
  captured_on: string
  impressions_search: number
  impressions_maps: number
  website_clicks: number
  call_clicks: number
  direction_requests: number
}

export interface GoogleBusinessSnapshotResult {
  skipped: boolean
  status: GooglePerformanceStatus
  error?: string
}

interface DatedValue {
  date?: { year?: number; month?: number; day?: number }
  value?: string | number
}

interface MetricSeriesNode {
  dailyMetric?: string
  timeSeries?: { datedValues?: DatedValue[] }
}

function dateKey(value: DatedValue["date"]): string | null {
  if (!value?.year || !value.month || !value.day) return null
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
}

function blankDay(captured_on: string): GooglePerformanceDay {
  return {
    captured_on,
    impressions_search: 0,
    impressions_maps: 0,
    website_clicks: 0,
    call_clicks: 0,
    direction_requests: 0,
  }
}

/** La API anida las series por metrica y, para algunas, por subentidad. Se recorre la respuesta
 * completa para tolerar ambas formas sin depender de una profundidad fija. */
export function parseGooglePerformanceResponse(input: unknown): GooglePerformanceDay[] {
  const rows = new Map<string, GooglePerformanceDay>()

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== "object") return

    const metricNode = node as MetricSeriesNode
    if (metricNode.dailyMetric && metricNode.timeSeries?.datedValues) {
      for (const datedValue of metricNode.timeSeries.datedValues) {
        const key = dateKey(datedValue.date)
        if (!key) continue
        const value = Number(datedValue.value ?? 0)
        if (!Number.isFinite(value)) continue
        const row = rows.get(key) ?? blankDay(key)
        if (metricNode.dailyMetric.includes("_SEARCH")) row.impressions_search += value
        else if (metricNode.dailyMetric.includes("_MAPS")) row.impressions_maps += value
        else if (metricNode.dailyMetric === "WEBSITE_CLICKS") row.website_clicks += value
        else if (metricNode.dailyMetric === "CALL_CLICKS") row.call_clicks += value
        else if (metricNode.dailyMetric === "BUSINESS_DIRECTION_REQUESTS") row.direction_requests += value
        rows.set(key, row)
      }
    }

    Object.values(node).forEach(visit)
  }

  visit(input)
  return [...rows.values()].sort((a, b) => a.captured_on.localeCompare(b.captured_on))
}

class GooglePerformanceError extends Error {
  constructor(message: string, readonly quotaBlocked: boolean) {
    super(message)
  }
}

function addDateParams(params: URLSearchParams, prefix: string, date: Date) {
  params.set(`${prefix}.year`, String(date.getUTCFullYear()))
  params.set(`${prefix}.month`, String(date.getUTCMonth() + 1))
  params.set(`${prefix}.day`, String(date.getUTCDate()))
}

async function fetchPerformance(
  token: string,
  locationId: string,
  start: Date,
  end: Date
): Promise<GooglePerformanceDay[]> {
  const params = new URLSearchParams()
  DAILY_METRICS.forEach(metric => params.append("dailyMetrics", metric))
  addDateParams(params, "daily_range.start_date", start)
  addDateParams(params, "daily_range.end_date", end)

  const cleanLocationId = locationId.replace(/^locations\//, "")
  const response = await fetch(
    `${PERFORMANCE_API}/locations/${encodeURIComponent(cleanLocationId)}:fetchMultiDailyMetricsTimeSeries?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  )
  if (!response.ok) {
    const body = await response.text()
    const quotaBlocked = response.status === 403 || response.status === 429 || /quota|permission/i.test(body)
    throw new GooglePerformanceError(`Google Performance API ${response.status}`, quotaBlocked)
  }
  return parseGooglePerformanceResponse(await response.json())
}

/**
 * Guarda rating/reseñas (Places API) y métricas nativas de la ficha (Performance API). Si Google
 * mantiene cuota 0, deja status=quota_blocked y no rompe el cron; el dashboard conserva el tracking
 * propio por /go/google como respaldo medible.
 */
export async function snapshotGoogleBusinessMetrics(
  supabase: SupabaseClient,
  now: Date
): Promise<GoogleBusinessSnapshotResult> {
  const capturedOn = now.toISOString().slice(0, 10)
  const places = await getGooglePlaceReviews()
  const connection = await getConnectionInfo(supabase)

  let status: GooglePerformanceStatus = "not_connected"
  let performanceRows: GooglePerformanceDay[] = []
  let errorMessage: string | undefined

  if (connection?.google_location_id) {
    try {
      const token = await getValidToken(supabase)
      if (!token) {
        status = "not_connected"
      } else {
        const start = new Date(now)
        start.setUTCDate(start.getUTCDate() - 7)
        performanceRows = await fetchPerformance(token, connection.google_location_id, start, now)
        status = "available"
      }
    } catch (error) {
      if (error instanceof GooglePerformanceError && error.quotaBlocked) {
        status = "quota_blocked"
      } else {
        status = "error"
        errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[google-performance] snapshot failed: ${errorMessage}`)
      }
    }
  }

  const todayPerformance = performanceRows.find(row => row.captured_on === capturedOn)
  const rows = performanceRows.map(row => ({ ...row, performance_status: "available", updated_at: now.toISOString() }))
  const today = {
    ...(todayPerformance ?? blankDay(capturedOn)),
    captured_on: capturedOn,
    rating: places?.rating ?? null,
    review_count: places?.reviewCount ?? null,
    performance_status: status,
    updated_at: now.toISOString(),
  }
  const withoutToday = rows.filter(row => row.captured_on !== capturedOn)
  const { error: databaseError } = await supabase
    .from("google_business_snapshots")
    .upsert([...withoutToday, today], { onConflict: "captured_on" })

  if (databaseError) {
    const message = databaseError.message
    console.error(`[google-performance] database snapshot failed: ${message}`)
    return { skipped: false, status: "error", error: message }
  }

  return {
    skipped: !places && !connection?.google_location_id,
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  }
}
