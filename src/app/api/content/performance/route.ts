import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems } from "@/lib/content-pipeline"
import { readContentInsightWindows } from "@/lib/content-insights"
import {
  buildContentPerformanceRows,
  buildContentStrategyRecommendations,
  type ContentAttributionAggregateRow,
} from "@/lib/content-performance"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

const CONTENT_ROLES = ["owner", "doctor"] as const
const ALLOWED_PERIODS = new Set([7, 30, 90, 180, 365])
const reviewSchema = z.object({
  days: z.number().int().refine(value => ALLOWED_PERIODS.has(value)),
  recommendationKey: z.string().trim().min(1).max(500),
  status: z.enum(["approved", "dismissed"]),
})

function readDays(url: URL): number {
  const value = Number(url.searchParams.get("days") ?? 90)
  return ALLOWED_PERIODS.has(value) ? value : 90
}

async function loadPerformance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  days: number,
) {
  const until = new Date()
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000)
  const items = await readContentItems(supabase)
  const [windowsByItem, attributionResult, recommendationResult] = await Promise.all([
    readContentInsightWindows(supabase, items),
    supabase.rpc("instagram_content_attribution", {
      p_since: since.toISOString(),
      p_until: until.toISOString(),
    }),
    supabase.from("instagram_strategy_recommendations").select("recommendation_key,status"),
  ])
  if (attributionResult.error) throw attributionResult.error
  if (recommendationResult.error) throw recommendationResult.error

  const rows = buildContentPerformanceRows(
    items.filter(item => {
      const publishedAt = item.published_at ?? item.manual_publish_note?.marked_at
      return publishedAt ? Date.parse(publishedAt) >= since.getTime() : false
    }),
    windowsByItem,
    (attributionResult.data ?? []) as ContentAttributionAggregateRow[],
  )
  const reviewed = new Map((recommendationResult.data ?? []).map(row => [row.recommendation_key, row.status]))
  const recommendations = buildContentStrategyRecommendations(rows).map(recommendation => ({
    ...recommendation,
    status: reviewed.get(recommendation.key) ?? "pending",
  }))
  return { rows, recommendations, since: since.toISOString(), until: until.toISOString() }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    const days = readDays(new URL(request.url))
    return NextResponse.json(await loadPerformance(supabase, days))
  } catch (error) {
    console.error(`[content/performance] ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ error: "No se pudo cargar el rendimiento de contenido" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })
  const parsed = reviewSchema.safeParse(parsedBody.data)
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
  }

  try {
    const performance = await loadPerformance(supabase, parsed.data.days)
    const recommendation = performance.recommendations.find(item => item.key === parsed.data.recommendationKey)
    if (!recommendation) {
      return NextResponse.json({ error: "La recomendación ya no tiene evidencia comparable vigente." }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { error } = await getServiceDb().from("instagram_strategy_recommendations").upsert({
      recommendation_key: recommendation.key,
      status: parsed.data.status,
      summary: recommendation.summary,
      evidence: recommendation.evidence,
      updated_at: now,
      reviewed_at: now,
    }, { onConflict: "recommendation_key" })
    if (error) throw error
    return NextResponse.json({ ok: true, status: parsed.data.status })
  } catch (error) {
    console.error(`[content/performance/review] ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ error: "No se pudo guardar la decisión estratégica" }, { status: 500 })
  }
}
