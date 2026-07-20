import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, CheckCircle2, Clock,
  MapPin, Camera, Search, MessageSquare, Globe, Lightbulb, Eye,
  MousePointerClick, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  CalendarDays, PhoneCall, Navigation, Star, BarChart3,
} from "lucide-react"
import { STATUS_LABELS, STATUS_COLORS, type Lead } from "@/types"
import { timeAgo } from "@/lib/utils"
import { LANDING_DATA, PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"
import {
  buildReferralLandingFunnels,
  type ReferralEventAggregate,
  type ReferralLandingFunnel,
  type ReferralLeadAggregate,
} from "@/lib/referral-funnel"
import { readAutoPublishSettings, readContentItems } from "@/lib/content-pipeline"
import { getGooglePlaceReviews } from "@/lib/google-places"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { getWhatsAppCostSummary } from "@/lib/whatsapp-cost-tracking"
import {
  buildGrowthRecommendations, evaluateAbTestReadiness,
  AB_TEST_MIN_VISITS_PER_VARIANT, AB_TEST_MIN_RATE_GAP,
  type GrowthRecommendation, type RecommendationChannel,
} from "@/lib/growth-recommendations"
import Link from "next/link"
import { TrendChart } from "@/components/dashboard/trend-chart"
import {
  getDashboardGrowthData,
  parseDashboardPeriod,
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  type PeriodValue,
} from "@/lib/dashboard-growth"

const CHANNEL_ICON: Record<RecommendationChannel, typeof Globe> = {
  web: Globe, whatsapp: MessageSquare, instagram: Camera, google: MapPin,
}
const CHANNEL_LABEL: Record<RecommendationChannel, string> = {
  web: "Web", whatsapp: "WhatsApp", instagram: "Instagram", google: "Google Maps",
}
const SEVERITY_BADGE: Record<GrowthRecommendation["severity"], string> = {
  critical: "bg-red-100 text-red-700",
  warning: "bg-orange-100 text-orange-700",
  info: "bg-blue-100 text-blue-700",
}

type LandingRankingRow = {
  slug: string
  label: string
  visits: number
  interactions: number
  rate: number
}

// Agregado en SQL (RPC landing_events_ranking, migración 20260712_landing_events_aggregation.sql)
// en vez de traer filas crudas y contar en JS — antes tenía un tope de 20.000 filas que, superado,
// subestimaba los conteos en silencio sin ningún error visible.
async function getLandingRanking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ rows: LandingRankingRow[]; available: boolean }> {
  try {
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc("landing_events_ranking", { p_since: since })
    if (error) throw error

    const bySlug = new Map<string, { visits: number; interactions: number }>()
    for (const row of (data ?? []) as { slug: string; visits: number | string; interactions: number | string }[]) {
      bySlug.set(row.slug, { visits: Number(row.visits), interactions: Number(row.interactions) })
    }

    const rows = PUBLIC_LANDING_SLUGS.map(slug => {
      const entry = bySlug.get(slug) ?? { visits: 0, interactions: 0 }
      return {
        slug,
        label: LANDING_DATA[slug]?.h1 ?? slug,
        visits: entry.visits,
        interactions: entry.interactions,
        rate: entry.visits > 0 ? Math.round((entry.interactions / entry.visits) * 100) : 0,
      }
    }).sort((a, b) => b.rate - a.rate || b.visits - a.visits)

    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

type ClicksByLocationRow = {
  locationKey: "cimel" | "swiss" | "britanico"
  locationLabel: string
  clickCall: number
  clickWhatsapp: number
}

const CLICK_LOCATION_LABEL: Record<string, string> = {
  cimel: "CIMEL Lanús", swiss: "Swiss Medical Lomas", britanico: "Hospital Británico",
}

// Reemplaza la vieja card "Métricas de landings" (cta_cimel/cta_swiss/cta_britanico/form_submitted),
// que quedó midiendo eventos que ya nadie dispara desde el rediseño del tracking del 2026-07-06 y
// por eso siempre mostraba 0. Esta sí usa los eventos reales (click_call, click_whatsapp +
// location_key). Cubre Swiss Medical y Hospital Británico aunque ninguno de los dos pase por el bot
// de WhatsApp de Lucía -- el click en sí se puede medir igual, lo que no se puede saber es si ese
// contacto externo (Swity, o el teléfono/central de turnos del Británico) terminó en un turno.
async function getClicksByLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ rows: ClicksByLocationRow[]; available: boolean }> {
  try {
    const { data, error } = await supabase.rpc("landing_clicks_by_location", { p_days: period })
    if (error) throw error

    const byLocation = new Map<string, { call: number; whatsapp: number }>()
    for (const row of (data ?? []) as { location_key: string; event_type: string; event_count: number | string }[]) {
      const entry = byLocation.get(row.location_key) ?? { call: 0, whatsapp: 0 }
      if (row.event_type === "click_call") entry.call = Number(row.event_count)
      else if (row.event_type === "click_whatsapp") entry.whatsapp = Number(row.event_count)
      byLocation.set(row.location_key, entry)
    }

    const rows: ClicksByLocationRow[] = (["cimel", "swiss", "britanico"] as const).map(locationKey => {
      const entry = byLocation.get(locationKey) ?? { call: 0, whatsapp: 0 }
      return {
        locationKey,
        locationLabel: CLICK_LOCATION_LABEL[locationKey],
        clickCall: entry.call,
        clickWhatsapp: entry.whatsapp,
      }
    })

    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

// click_instagram se graba desde el PR #104 (2026-07-16, link de confianza a Instagram en las 7
// landings) pero a propósito nunca se sumó a ACTION_META/contact_actions (no es un paso hacia pedir
// turno, mezclarlo ahí infla la tasa de conversión de forma engañosa) -- por eso no se veía en
// ningún lado de /dashboard hasta ahora. Conteo simple y separado, mismo patrón que getClicksByLocation.
async function getInstagramWebClicks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ count: number; available: boolean }> {
  try {
    const { data, error } = await supabase.rpc("landing_instagram_clicks", { p_days: period })
    if (error) throw error
    return { count: Number(data ?? 0), available: true }
  } catch {
    return { count: 0, available: false }
  }
}

type HeroVariantRow = {
  variant: "a" | "b"
  visits: number
  pedirTurnoClicks: number
  verSedesClicks: number
  interactions: number
  interactionRate: number
}

// Test A/B del hero de /dra-lucia-chahin (2026-07-07) — variante "b" invierte cual boton es
// primario ("Pedir turno" vs "Ver sedes y horarios"). Ver src/app/landings/[slug]/page.tsx.
// Agregado en SQL (RPC landing_hero_variant_results) por el mismo motivo que getLandingRanking.
async function getHeroVariantResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ rows: HeroVariantRow[]; available: boolean }> {
  try {
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc("landing_hero_variant_results", { p_since: since })
    if (error) throw error

    const byVariant = new Map<"a" | "b", { visits: number; heroPrimaryClicks: number; heroSecondaryClicks: number; interactions: number }>()
    for (const row of (data ?? []) as {
      variant: string
      visits: number | string
      hero_primary_clicks: number | string
      hero_secondary_clicks: number | string
      interactions: number | string
    }[]) {
      if (row.variant !== "a" && row.variant !== "b") continue
      byVariant.set(row.variant, {
        visits: Number(row.visits),
        heroPrimaryClicks: Number(row.hero_primary_clicks),
        heroSecondaryClicks: Number(row.hero_secondary_clicks),
        interactions: Number(row.interactions),
      })
    }

    const rows: HeroVariantRow[] = (["a", "b"] as const).map(variant => {
      const entry = byVariant.get(variant) ?? { visits: 0, heroPrimaryClicks: 0, heroSecondaryClicks: 0, interactions: 0 }
      // La variante "b" invierte cual boton es primario, asi que hay que reasignar antes de
      // mostrar: "primary" en A es "Pedir turno", pero en B es "Ver sedes y horarios".
      const pedirTurnoClicks = variant === "a" ? entry.heroPrimaryClicks : entry.heroSecondaryClicks
      const verSedesClicks = variant === "a" ? entry.heroSecondaryClicks : entry.heroPrimaryClicks
      return {
        variant,
        visits: entry.visits,
        pedirTurnoClicks,
        verSedesClicks,
        interactions: entry.interactions,
        interactionRate: entry.visits > 0 ? Math.round((entry.interactions / entry.visits) * 100) : 0,
      }
    })

    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

// GROWTH-01: embudo real visita → clic WhatsApp → lead → turno confirmado, por código de
// referencia (ver src/lib/landing-referral-codes.ts). Visitas/clicks agregados en SQL (RPC
// landing_referral_events, migración 20260712_growth_01_referral_attribution.sql) — leads es una
// tabla chica sin historial de problemas de escala, así que se agrega en JS sin RPC dedicada.
// El código de respaldo compartido "WEB-GRAL-01" (no atado a una sola landing) queda afuera de
// esta tabla a propósito: mostrar "0 visitas" sería engañoso para un link que no se trackea por slug.
async function getReferralFunnel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ landings: ReferralLandingFunnel[]; available: boolean }> {
  try {
    const { data: events, error } = await supabase.rpc("landing_referral_events", { p_days: period })
    if (error) throw error

    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString()
    const { data: leadsData, error: leadsError } = await supabase
      .from("leads")
      .select("utm_content, confirmed_booked")
      .not("utm_content", "is", null)
      .gte("created_at", since)
    if (leadsError) throw leadsError

    return {
      landings: buildReferralLandingFunnels(
        (events ?? []) as ReferralEventAggregate[],
        (leadsData ?? []) as ReferralLeadAggregate[],
      ),
      available: true,
    }
  } catch {
    return { landings: [], available: false }
  }
}

// Sistema de recomendaciones de crecimiento (2026-07-07) — motor de reglas simples (sin ML) sobre
// datos que la app ya junta hoy en 4 canales (web/landings, WhatsApp, Instagram, Google Maps).
// La logica de cada regla vive en growth-recommendations.ts (testeada por separado); esta funcion
// solo hace el fetch minimo de cada canal y arma el input. Ver CLAUDE.md.
async function getGrowthRecommendationsData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  landingRanking: LandingRankingRow[],
  heroVariantRows: HeroVariantRow[],
  period: DashboardPeriod
): Promise<{ recommendations: GrowthRecommendation[]; available: boolean }> {
  try {
    const serviceDb = getServiceDb()
    const now = new Date()
    const since1d = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const staleCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

    const [
      { data: locationsConfig },
      { data: cost1dEvents },
      whatsappSettings,
      { count: unapprovedTemplatesCount },
      { data: sessions },
      { data: instagramConn },
      { data: googleConn },
      autoPublishSettings,
      placesReviews,
    ] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", "locations").maybeSingle(),
      supabase.from("whatsapp_cost_events").select("cost_estimated").eq("direction", "outbound").gte("created_at", since1d),
      getWhatsAppSettings(),
      supabase.from("templates").select("id", { count: "exact", head: true }).neq("status", "aprobado"),
      supabase.from("whatsapp_sessions").select("state, updated_at"),
      serviceDb.from("app_config").select("key").eq("key", "instagram_access_token").maybeSingle(),
      serviceDb.from("app_config").select("key").eq("key", "google_refresh_token").maybeSingle(),
      readAutoPublishSettings(supabase),
      getGooglePlaceReviews(),
    ])

    const locations = Array.isArray(locationsConfig?.value)
      ? (locationsConfig.value as { name: string; obras_sociales?: string[] }[]).map(l => ({
          name: l.name, obrasSociales: l.obras_sociales ?? [],
        }))
      : []

    const cost1dTotal = (cost1dEvents ?? []).reduce((sum, r) => sum + (r.cost_estimated ?? 0), 0)
    const abandonedConversations = (sessions ?? []).filter(
      s => s.state !== "derivado" && s.updated_at < staleCutoff
    ).length

    const recommendations = buildGrowthRecommendations({
      now,
      windowDays: period,
      landingRanking: landingRanking.map(r => ({ slug: r.slug, label: r.label, visits: r.visits, rate: r.rate })),
      heroVariantResults: heroVariantRows.map(r => ({ variant: r.variant, visits: r.visits, interactionRate: r.interactionRate })),
      locations,
      whatsapp: {
        webhookSignatureConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
        projectedMonthlyCost: cost1dTotal * 30,
        monthlyCostAlertArs: whatsappSettings.monthly_cost_alert_ars,
        unapprovedTemplatesCount: unapprovedTemplatesCount ?? 0,
        abandonedConversations,
      },
      instagram: {
        connected: Boolean(instagramConn?.key),
        post: autoPublishSettings.post,
        historia: autoPublishSettings.historia,
      },
      google: {
        businessConnected: Boolean(googleConn?.key),
        placesReviews,
      },
    })

    return { recommendations, available: true }
  } catch {
    return { recommendations: [], available: false }
  }
}

type WeeklyReportMetrics = {
  leads_total: number
  leads_confirmed: number
  conversion_rate: number
  landing_visits: number
  landing_interactions: number
}

type WeeklyReportRow = {
  week_start: string
  week_end: string
  metrics: WeeklyReportMetrics
}

async function getWeeklyReports(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: WeeklyReportRow[]; available: boolean }> {
  try {
    const { data, error } = await supabase
      .from("weekly_reports")
      .select("week_start, week_end, metrics")
      .order("week_start", { ascending: false })
      .limit(6)
    if (error) throw error
    return { rows: (data ?? []) as WeeklyReportRow[], available: true }
  } catch {
    return { rows: [], available: false }
  }
}

async function count(supabase: Awaited<ReturnType<typeof createClient>>, filter: Record<string, unknown>) {
  const query = supabase.from("leads").select("id", { count: "exact", head: true })
  let q = query
  for (const [key, value] of Object.entries(filter)) {
    q = q.eq(key as string, value as string)
  }
  const { count: n } = await q
  return n ?? 0
}

async function getDashboardData(period: DashboardPeriod) {
  const supabase = await createClient()

  const [
    { count: total },
    { data: recentLeads },
    confirmed,
    requires_human,
    emergencies,
    followup_pending,
    derivado_cimel,
    derivado_swiss,
    derivado_britanico,
    gm, gs, ig, wa, manual,
    consulta, eco,
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(5),
    count(supabase, { confirmed_booked: true }),
    count(supabase, { requires_human: true }),
    count(supabase, { possible_emergency: true }),
    count(supabase, { status: "seguimiento_pendiente" }),
    count(supabase, { status: "derivado_cimel" }),
    count(supabase, { status: "derivado_swiss" }),
    count(supabase, { status: "derivado_britanico" }),
    count(supabase, { origin_channel: "google_maps" }),
    count(supabase, { origin_channel: "google_search" }),
    count(supabase, { origin_channel: "instagram" }),
    count(supabase, { origin_channel: "whatsapp" }),
    count(supabase, { origin_channel: "manual" }),
    count(supabase, { requested_service: "consulta_cardiologia" }),
    count(supabase, { requested_service: "ecocardiograma" }),
  ])

  const totalLeads = total ?? 0
  const metrics = {
    total: totalLeads,
    confirmed,
    requires_human,
    emergencies,
    followup_pending,
    derivado_cimel,
    derivado_swiss,
    derivado_britanico,
    by_channel: { google_maps: gm, google_search: gs, instagram: ig, whatsapp: wa, manual },
    consulta,
    eco,
  }

  const [
    landingRanking,
    heroVariantResults,
    referralFunnel,
    clicksByLocation,
    instagramWebClicks,
    whatsappCostSummary,
    weeklyReports,
    growth,
    contentPerformance,
  ] = await Promise.all([
    getLandingRanking(supabase, period),
    getHeroVariantResults(supabase, period),
    getReferralFunnel(supabase, period),
    getClicksByLocation(supabase, period),
    getInstagramWebClicks(supabase, period),
    getWhatsAppCostSummary(supabase),
    getWeeklyReports(supabase),
    getDashboardGrowthData(supabase, period),
    getContentPerformance(supabase, period),
  ])
  const growthRecommendations = await getGrowthRecommendationsData(supabase, landingRanking.rows, heroVariantResults.rows, period)

  return {
    metrics, recentLeads: (recentLeads ?? []) as Lead[],
    landingRanking, heroVariantResults, referralFunnel, clicksByLocation, instagramWebClicks,
    whatsappCostSummary, growthRecommendations, weeklyReports, growth, contentPerformance,
  }
}

type ContentPerformanceRow = {
  itemId: string
  topic: string
  format: string
  visits: number
  engagedVisits: number
}

async function getContentPerformance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: DashboardPeriod
): Promise<{ rows: ContentPerformanceRow[]; available: boolean }> {
  try {
    const [{ data, error }, items] = await Promise.all([
      supabase.rpc("dashboard_content_performance", { p_days: period }),
      readContentItems(supabase),
    ])
    if (error) throw error
    const itemById = new Map(items.map(item => [item.id, item]))
    const rows = ((data ?? []) as Array<{ item_id: string; visits: number | string; engaged_visits: number | string }>)
      .map(row => ({
        itemId: row.item_id,
        topic: itemById.get(row.item_id)?.topic ?? "Pieza sin título",
        format: itemById.get(row.item_id)?.format ?? "contenido",
        visits: Number(row.visits),
        engagedVisits: Number(row.engaged_visits),
      }))
      .slice(0, 5)
    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

function SectionHeader({ icon: Icon, title }: { icon: typeof Globe; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Icon className="h-4 w-4 text-gray-400" />
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
    </div>
  )
}

function Money({ amount, currency, pending }: { amount: number; currency: string; pending?: number }) {
  return (
    <span>
      {currency} {amount.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
      {!!pending && <span className="ml-1 text-xs text-amber-600">(+{pending} sin tarifa)</span>}
    </span>
  )
}

function Comparison({ value, rate = false }: { value: PeriodValue; rate?: boolean }) {
  const difference = value.current - value.previous
  if (difference === 0) {
    return <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Minus className="h-3 w-3" /> sin cambio</span>
  }
  if (value.previous === 0 && !rate) {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><ArrowUpRight className="h-3 w-3" /> nuevo</span>
  }
  const label = rate
    ? `${difference > 0 ? "+" : ""}${difference.toLocaleString("es-AR", { maximumFractionDigits: 1 })} pp`
    : `${difference > 0 ? "+" : ""}${Math.round((difference / Math.max(value.previous, 1)) * 100)}%`
  const positive = difference > 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? "text-emerald-600" : "text-rose-600"}`}>
      {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {label}
    </span>
  )
}

function KpiCard({
  title,
  value,
  comparison,
  icon: Icon,
  iconClass,
  note,
  rate = false,
}: {
  title: string
  value: number | string
  comparison?: PeriodValue
  icon: typeof Globe
  iconClass: string
  note?: string
  rate?: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 md:p-4">
        <div className="mb-2 flex items-start justify-between gap-2 md:mb-4 md:gap-3">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:h-9 md:w-9 md:rounded-xl ${iconClass}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">{value}</p>
        <div className="mt-0.5 min-h-4 md:mt-1 md:min-h-5">
          {comparison ? <Comparison value={comparison} rate={rate} /> : note ? <p className="text-xs text-gray-400">{note}</p> : null}
          {comparison && <span className="ml-1 text-xs text-gray-400">vs. período anterior</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricTile({ label, value, helper }: { label: string; value: number | string | null; helper?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-950">{value === null ? "—" : value}</p>
      {helper && <p className="mt-0.5 text-[11px] text-gray-400">{helper}</p>}
    </div>
  )
}

const CHANNEL_META: Record<string, { label: string; icon: typeof Globe; className: string }> = {
  google_maps: { label: "Google Maps", icon: MapPin, className: "bg-blue-50 text-blue-700" },
  google_search: { label: "Google Search", icon: Search, className: "bg-violet-50 text-violet-700" },
  instagram: { label: "Instagram", icon: Camera, className: "bg-pink-50 text-pink-700" },
  whatsapp: { label: "WhatsApp", icon: MessageSquare, className: "bg-emerald-50 text-emerald-700" },
  referral: { label: "Referidos", icon: Users, className: "bg-amber-50 text-amber-700" },
  landing_page: { label: "Landing / directo", icon: Globe, className: "bg-gray-100 text-gray-700" },
  direct: { label: "Directo / sin UTM", icon: Globe, className: "bg-gray-100 text-gray-700" },
  manual: { label: "Carga manual", icon: Users, className: "bg-gray-100 text-gray-700" },
}

const ACTION_META: Record<string, { label: string; icon: typeof Globe; className: string }> = {
  click_booking: { label: "Turno online", icon: CalendarDays, className: "bg-indigo-50 text-indigo-700" },
  click_whatsapp: { label: "WhatsApp", icon: MessageSquare, className: "bg-emerald-50 text-emerald-700" },
  click_call: { label: "Llamadas", icon: PhoneCall, className: "bg-sky-50 text-sky-700" },
  click_maps: { label: "Cómo llegar", icon: Navigation, className: "bg-amber-50 text-amber-700" },
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>
}) {
  const period = parseDashboardPeriod((await searchParams).period)
  const {
    metrics, recentLeads, landingRanking,
    heroVariantResults, referralFunnel, clicksByLocation, instagramWebClicks,
    whatsappCostSummary, growthRecommendations, weeklyReports, growth, contentPerformance,
  } = await getDashboardData(period)

  const maxFunnel = Math.max(growth.summary.visits.current, 1)
  const instagramChannel = growth.channels.find(channel => channel.channel === "instagram")
  const googleChannel = growth.channels.find(channel => channel.channel === "google_maps")

  return (
    <div className="space-y-5 bg-gray-50/60 p-4 md:space-y-7 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Growth OS</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">Dashboard de crecimiento</h1>
          <p className="mt-1 text-sm text-gray-500">De la visita al turno confirmado, con evolución y atribución por canal.</p>
        </div>
        <div className="flex w-fit rounded-xl border border-gray-200 bg-white p-1 shadow-sm" aria-label="Período del dashboard">
          {DASHBOARD_PERIODS.map(value => (
            <Link
              key={value}
              href={`/dashboard?period=${value}`}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${period === value ? "bg-gray-950 text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
            >
              {value === 365 ? "1 año" : `${value} días`}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <KpiCard title="Visitas web" value={growth.available ? growth.summary.visits.current : "—"} comparison={growth.available ? growth.summary.visits : undefined} icon={Eye} iconClass="bg-indigo-50 text-indigo-700" />
        <KpiCard title="Visitas con acción" value={growth.available ? growth.summary.engagedVisits.current : "—"} comparison={growth.available ? growth.summary.engagedVisits : undefined} icon={MousePointerClick} iconClass="bg-cyan-50 text-cyan-700" />
        <KpiCard title="Leads nuevos" value={growth.available ? growth.summary.leads.current : "—"} comparison={growth.available ? growth.summary.leads : undefined} icon={Users} iconClass="bg-violet-50 text-violet-700" />
        <KpiCard title="Turnos confirmados" value={growth.available ? growth.summary.confirmed.current : "—"} comparison={growth.available ? growth.summary.confirmed : undefined} icon={CheckCircle2} iconClass="bg-emerald-50 text-emerald-700" />
        <KpiCard title="Lead → turno" value={growth.available ? `${growth.summary.leadToConfirmedRate.current}%` : "—"} comparison={growth.available ? growth.summary.leadToConfirmedRate : undefined} rate icon={TrendingUp} iconClass="bg-green-50 text-green-700" />
        <KpiCard title="Seguimientos pendientes" value={metrics.followup_pending} icon={Clock} iconClass="bg-amber-50 text-amber-700" note="estado actual" />
      </div>

      {!growth.available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          La nueva serie temporal todavía no está disponible. Se habilita al aplicar la migración de métricas; el resto del dashboard sigue operativo.
        </div>
      )}

      {/* Evolución + embudo */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-indigo-600" /> Evolución del embudo</CardTitle>
            <p className="text-xs text-gray-500">Datos diarios de los últimos {period === 365 ? "12 meses" : `${period} días`}. Los turnos se atribuyen a la fecha de entrada del lead.</p>
          </CardHeader>
          <CardContent>
            <TrendChart
              points={growth.trend}
              series={[
                { key: "visits", label: "Visitas", color: "#4f46e5" },
                { key: "engagedVisits", label: "Con acción", color: "#0891b2" },
                { key: "leads", label: "Leads", color: "#7c3aed" },
                { key: "confirmed", label: "Turnos", color: "#059669" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Embudo del período</CardTitle>
            <p className="text-xs text-gray-500">Personas, no cantidad de botones tocados.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: "Visitas", value: growth.summary.visits.current, color: "bg-indigo-500" },
              { label: "Hicieron una acción", value: growth.summary.engagedVisits.current, color: "bg-cyan-500" },
              { label: "Se convirtieron en lead", value: growth.summary.leads.current, color: "bg-violet-500" },
              { label: "Confirmaron que pidieron turno", value: growth.summary.confirmed.current, color: "bg-emerald-500" },
            ].map(item => (
              <div key={item.label}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-semibold text-gray-950">{item.value}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${Math.max(item.value > 0 ? 4 : 0, (item.value / maxFunnel) * 100)}%` }} />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-4">
              <MetricTile label="Visita → lead" value={`${growth.summary.visitToLeadRate.current}%`} />
              <MetricTile label="Lead → turno" value={`${growth.summary.leadToConfirmedRate.current}%`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Canales del período */}
      {growth.channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canales que generan pacientes</CardTitle>
            <p className="text-xs text-gray-500">Visitas atribuidas por UTM y leads del período. “Directo / sin UTM” señala enlaces que conviene reemplazar por los medibles de Instagram y Google.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-3 font-medium">Canal</th>
                    <th className="pb-3 text-right font-medium">Visitas</th>
                    <th className="pb-3 text-right font-medium">Leads</th>
                    <th className="pb-3 text-right font-medium">Visita → lead</th>
                    <th className="pb-3 text-right font-medium">Turnos</th>
                    <th className="pb-3 text-right font-medium">Lead → turno</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.channels.map(channel => {
                    const meta = CHANNEL_META[channel.channel] ?? { label: channel.channel, icon: Globe, className: "bg-gray-100 text-gray-700" }
                    const Icon = meta.icon
                    return (
                      <tr key={channel.channel} className="border-b border-gray-50 last:border-0">
                        <td className="py-3 pr-4">
                          <span className="flex items-center gap-2 font-medium text-gray-900">
                            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.className}`}><Icon className="h-4 w-4" /></span>
                            {meta.label}
                          </span>
                        </td>
                        <td className="py-3 text-right text-gray-700">{channel.visits}</td>
                        <td className="py-3 text-right font-semibold text-gray-900">{channel.leads}</td>
                        <td className="py-3 text-right text-gray-700">{channel.visitToLeadRate}%</td>
                        <td className="py-3 text-right font-semibold text-emerald-700">{channel.confirmed}</td>
                        <td className="py-3 text-right text-gray-700">{channel.leadToConfirmedRate}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recomendaciones de crecimiento */}
      {growthRecommendations.available && growthRecommendations.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Recomendaciones de crecimiento
            </CardTitle>
            <p className="text-xs text-gray-500">
              Reglas simples sobre los datos que ya se juntan en web, WhatsApp, Instagram y Google Maps
              — no hay acción automática, cada una es para que decidas vos.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {growthRecommendations.recommendations.map(rec => {
              const Icon = CHANNEL_ICON[rec.channel]
              const content = (
                <div className="flex items-start gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_BADGE[rec.severity]}`}>
                        {rec.severity === "critical" ? "Crítico" : rec.severity === "warning" ? "Atención" : "Info"}
                      </span>
                      <span className="text-[11px] font-medium text-gray-400">{CHANNEL_LABEL[rec.channel]}</span>
                    </div>
                    <p className="text-sm text-gray-700">{rec.message}</p>
                  </div>
                </div>
              )
              return rec.href ? (
                <Link key={rec.id} href={rec.href} className="block">{content}</Link>
              ) : (
                <div key={rec.id}>{content}</div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <SectionHeader icon={Users} title="Pacientes y leads" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Por canal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads por canal · histórico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Google Maps", value: metrics.by_channel.google_maps, icon: MapPin, color: "text-blue-600" },
              { label: "Google Search", value: metrics.by_channel.google_search, icon: Search, color: "text-purple-600" },
              { label: "Instagram", value: metrics.by_channel.instagram, icon: Camera, color: "text-pink-600" },
              { label: "WhatsApp", value: metrics.by_channel.whatsapp, icon: MessageSquare, color: "text-green-600" },
              { label: "Manual", value: metrics.by_channel.manual, icon: Users, color: "text-gray-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className="text-sm text-gray-700">{label}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Por servicio y ubicación */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por servicio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Consulta cardiológica</span>
              <span className="text-sm font-semibold text-gray-900">{metrics.consulta}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Ecocardiograma</span>
              <span className="text-sm font-semibold text-gray-900">{metrics.eco}</span>
            </div>
            <div className="mt-4 border-t pt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Por institución</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">CIMEL Lanús</span>
                  <span className="text-sm font-semibold text-indigo-600">{metrics.derivado_cimel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Hospital Británico</span>
                  <span className="text-sm font-semibold text-sky-600">{metrics.derivado_britanico}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">Swiss Medical Lomas</span>
                  <span className="text-sm font-semibold text-teal-600">{metrics.derivado_swiss}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leads recientes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leads recientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentLeads.length === 0 && (
              <p className="text-sm text-gray-400">No hay leads todavía</p>
            )}
            {recentLeads.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center justify-between hover:bg-gray-50 -mx-2 px-2 py-1 rounded">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {lead.name ?? lead.instagram_username ?? lead.phone ?? "Anónimo"}
                  </p>
                  <p className="text-xs text-gray-400">{timeAgo(lead.created_at)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status]}`}>
                  {STATUS_LABELS[lead.status]}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <SectionHeader icon={Globe} title="Sitio web y landings" />

      {/* Acciones web del período */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qué hacen las personas en la web</CardTitle>
          <p className="text-xs text-gray-500">Clicks reales en los canales de pedido de turno durante el período seleccionado. Una misma visita puede hacer más de una acción.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(ACTION_META).map(([eventType, meta]) => {
              const row = growth.actions.find(action => action.eventType === eventType)
              const Icon = meta.icon
              return (
                <div key={eventType} className="rounded-xl border border-gray-100 p-4">
                  <span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${meta.className}`}><Icon className="h-4 w-4" /></span>
                  <p className="text-2xl font-bold text-gray-950">{row?.actions ?? 0}</p>
                  <p className="text-sm text-gray-600">{meta.label}</p>
                  {row && <div className="mt-1"><Comparison value={{ current: row.actions, previous: row.previousActions }} /></div>}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Ranking de landings */}
      {landingRanking.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranking de landings</CardTitle>
            <p className="text-xs text-gray-500">
              Visitas e interacciones con los botones de pedir turno (últimos {period}{" "}días). La tasa de
              interacción es la proporción de visitas que hicieron click en pedir turno online, llamar,
              WhatsApp o cómo llegar — no confirma que hayan pedido turno.
            </p>
          </CardHeader>
          <CardContent>
            {landingRanking.rows.every(row => row.visits === 0) ? (
              <p className="text-sm text-gray-400">
                Todavía no hay visitas registradas. Este dato empieza a acumularse desde que se agregó
                el tracking de visitas (2026-07-06).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Landing</th>
                      <th className="pb-2 font-medium text-right">Visitas</th>
                      <th className="pb-2 font-medium text-right">Interacciones</th>
                      <th className="pb-2 font-medium text-right">Tasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landingRanking.rows.map(row => (
                      <tr key={row.slug} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-2 text-gray-900">
                          <Link href={`/${row.slug}`} target="_blank" className="hover:underline">
                            {row.label}
                          </Link>
                        </td>
                        <td className="py-2 text-right text-gray-700">{row.visits}</td>
                        <td className="py-2 text-right text-gray-700">{row.interactions}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{row.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Clicks por sede: llamada y WhatsApp (incluye Swiss y Británico, que no pasan por el bot) */}
      {clicksByLocation.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clicks por sede: llamada y WhatsApp</CardTitle>
            <p className="text-xs text-gray-500">
              Últimos {period}{" "}días. Incluye Swiss Medical y Hospital Británico aunque ninguna de las dos
              sedes pase por el bot de WhatsApp de Lucía (Swiss usa su propio WhatsApp, &quot;Swity&quot;;
              Británico deriva a teléfono/central de turnos) — se puede medir el click, pero no si ese
              contacto externo terminó en un turno confirmado.
            </p>
          </CardHeader>
          <CardContent>
            {clicksByLocation.rows.every(row => row.clickCall === 0 && row.clickWhatsapp === 0) ? (
              <p className="text-sm text-gray-400">Todavía no hay clicks registrados en esta ventana.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Sede</th>
                      <th className="pb-2 font-medium text-right">Llamar</th>
                      <th className="pb-2 font-medium text-right">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clicksByLocation.rows.map(row => (
                      <tr key={row.locationKey} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-2 text-gray-900">{row.locationLabel}</td>
                        <td className="py-2 text-right text-gray-700">{row.clickCall}</td>
                        <td className="py-2 text-right text-gray-700">{row.clickWhatsapp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Clicks al link de confianza de Instagram desde la web (PR #104, sin card hasta ahora) */}
      {instagramWebClicks.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clicks a Instagram desde la web</CardTitle>
            <p className="text-xs text-gray-500">
              Últimos {period}{" "}días. Cuenta clicks en el link de confianza a Instagram de las 7 landings
              públicas — no cuenta como paso hacia pedir turno, es un dato aparte de la tasa de conversión.
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">{instagramWebClicks.count}</p>
          </CardContent>
        </Card>
      )}

      {/* Embudo de atribución agrupado por landing (GROWTH-01) */}
      {referralFunnel.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atribución por landing</CardTitle>
            <p className="text-xs text-gray-500">
              Cada landing aparece una sola vez: visita → clic a WhatsApp → lead → turno confirmado
              durante los últimos {period} días. Las visitas son únicas por pestaña; el desglose inferior
              muestra qué sede recibió cada clic y conversión.
            </p>
          </CardHeader>
          <CardContent>
            {referralFunnel.landings.every(row => row.visits === 0 && row.leads === 0) ? (
              <p className="text-sm text-gray-400">
                Todavía no hay datos para este embudo. Se empieza a acumular desde que se agregó el
                código de referencia a los mensajes de WhatsApp (2026-07-12).
              </p>
            ) : (
              <div className="space-y-3">
                {referralFunnel.landings.map(landing => (
                  <article key={landing.landingSlug} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(240px,1fr)_minmax(420px,1.15fr)] lg:items-center">
                      <div className="min-w-0">
                        <Link
                          href={`/${landing.landingSlug}`}
                          target="_blank"
                          className="font-semibold text-gray-950 hover:text-indigo-700 hover:underline"
                        >
                          {LANDING_DATA[landing.landingSlug]?.h1 ?? landing.landingSlug}
                        </Link>
                        <p className="mt-1 text-xs text-gray-400">{landing.specialty} · /{landing.landingSlug}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { label: "Visitas únicas", value: landing.visits, className: "text-indigo-700" },
                          { label: "Clics WhatsApp", value: landing.whatsappClicks, className: "text-emerald-700" },
                          { label: "Leads atribuidos", value: landing.leads, className: "text-violet-700" },
                          { label: "Turnos", value: landing.confirmed, className: "text-gray-950" },
                        ].map(metric => (
                          <div key={metric.label} className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                            <p className={`text-lg font-bold ${metric.className}`}>{metric.value}</p>
                            <p className="text-[11px] text-gray-500">{metric.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-gray-100 bg-gray-50/70 p-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Desglose por sede</p>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {landing.destinations.map(destination => (
                          <div key={destination.code} className="rounded-lg border border-gray-100 bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-semibold text-gray-800">{destination.locationLabel}</p>
                              <span className="font-mono text-[10px] text-gray-400">{destination.code}</span>
                            </div>
                            <p className="mt-2 text-xs text-gray-600">
                              <strong className="text-emerald-700">{destination.whatsappClicks}</strong> clics
                              <span className="mx-1.5 text-gray-300">→</span>
                              <strong className="text-violet-700">{destination.leads}</strong> leads
                              <span className="mx-1.5 text-gray-300">→</span>
                              <strong className="text-gray-900">{destination.confirmed}</strong> turnos
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
                <p className="px-1 text-[11px] text-gray-400">
                  La atribución depende del código incluido en el mensaje prellenado. Si la persona abre
                  WhatsApp pero no envía el mensaje, o borra el código, queda el clic pero no el lead atribuido.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Test A/B del hero principal */}
      {heroVariantResults.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test A/B: hero de la landing principal</CardTitle>
            <p className="text-xs text-gray-500">
              La variante B invierte cuál botón del hero es primario (&quot;Pedir turno&quot; vs
               &quot;Ver sedes y horarios&quot;), asignada automáticamente 50/50 por cookie (últimos {period}{" "}
              días). No hay ganador automático — mirá la tasa de interacción y decidí manualmente
              cuándo cortar el test.
            </p>
            <p className="text-xs text-gray-500">
              Criterio de finalización: se necesitan al menos {AB_TEST_MIN_VISITS_PER_VARIANT} visitas
              por variante y una diferencia de al menos {AB_TEST_MIN_RATE_GAP} puntos de interacción
              entre ambas para considerar el resultado confiable — con menos que eso, cualquier
              diferencia puede ser ruido.
            </p>
          </CardHeader>
          <CardContent>
            {heroVariantResults.rows.every(row => row.visits === 0) ? (
              <p className="text-sm text-gray-400">Todavía no hay visitas con variante asignada.</p>
            ) : (
              <>
                {(() => {
                  const readiness = evaluateAbTestReadiness(heroVariantResults.rows)
                  if (readiness === "insufficient_sample") {
                    const missing = heroVariantResults.rows.map(row => ({
                      variant: row.variant,
                      missing: Math.max(AB_TEST_MIN_VISITS_PER_VARIANT - row.visits, 0),
                    })).filter(r => r.missing > 0)
                    return (
                      <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                        Resultado preliminar — muestra insuficiente todavía
                        {missing.length > 0 && (
                          <> (faltan {missing.map(m => `${m.missing} visitas en ${m.variant.toUpperCase()}`).join(" y ")}
                          {" "}para el mínimo de {AB_TEST_MIN_VISITS_PER_VARIANT} por variante)</>
                        )}.
                      </p>
                    )
                  }
                  if (readiness === "no_clear_signal") {
                    return (
                      <p className="mb-3 text-xs text-blue-700 bg-blue-50 rounded px-2 py-1.5">
                        Ya hay muestra suficiente, pero la diferencia entre variantes todavía no llega a
                        {" "}{AB_TEST_MIN_RATE_GAP} puntos — no alcanza para preferir una sobre la otra todavía.
                      </p>
                    )
                  }
                  return (
                    <p className="mb-3 text-xs text-green-700 bg-green-50 rounded px-2 py-1.5">
                      Hay señal suficiente para elegir una variante — ver &quot;Recomendaciones de
                      crecimiento&quot; más abajo.
                    </p>
                  )
                })()}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-2 font-medium">Variante</th>
                        <th className="pb-2 font-medium text-right">Visitas</th>
                        <th className="pb-2 font-medium text-right">Click &quot;Pedir turno&quot;</th>
                        <th className="pb-2 font-medium text-right">Click &quot;Ver sedes&quot;</th>
                        <th className="pb-2 font-medium text-right">Interacciones</th>
                        <th className="pb-2 font-medium text-right">Tasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroVariantResults.rows.map(row => (
                        <tr key={row.variant} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-2 font-medium text-gray-900">
                            {row.variant === "a" ? "A — Pedir turno primero" : "B — Ver sedes primero"}
                          </td>
                          <td className="py-2 text-right text-gray-700">{row.visits}</td>
                          <td className="py-2 text-right text-gray-700">{row.pedirTurnoClicks}</td>
                          <td className="py-2 text-right text-gray-700">{row.verSedesClicks}</td>
                          <td className="py-2 text-right text-gray-700">{row.interactions}</td>
                          <td className="py-2 text-right font-semibold text-gray-900">{row.interactionRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader icon={MessageSquare} title="WhatsApp" />

      {/* Costo de WhatsApp (mismo cálculo que /costos, resumen liviano) */}
      {whatsappCostSummary.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Costo de WhatsApp</CardTitle>
            <p className="text-xs text-gray-500">
              Mensajes salientes con tarifa cargada (últimos 7 y 30 días). Detalle completo, costo
              por paciente/turno/protocolo y ranking de flows en{" "}
              <Link href="/costos" className="underline">/costos</Link>.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-2">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  <Money amount={whatsappCostSummary.cost7d.total} currency={whatsappCostSummary.currency} pending={whatsappCostSummary.cost7d.pending} />
                </p>
                <p className="text-xs text-gray-500 mt-1">Últimos 7 días</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  <Money amount={whatsappCostSummary.cost30d.total} currency={whatsappCostSummary.currency} pending={whatsappCostSummary.cost30d.pending} />
                </p>
                <p className="text-xs text-gray-500 mt-1">Últimos 30 días</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <SectionHeader icon={Camera} title="Instagram" />

      {growth.instagram.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4 text-pink-600" /> Instagram: alcance y tráfico
            </CardTitle>
            <p className="text-xs text-gray-500">Insights nativos de Meta más las visitas y leads que llegaron por el enlace medible de la bio.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {growth.instagram.followers === null ? (
              <p className="text-sm text-gray-400">
                Todavía no hay snapshots. Hace falta Instagram conectado y al menos una corrida del cron diario.
              </p>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetricTile label="Seguidores" value={growth.instagram.followers} helper={growth.instagram.followersDelta === null ? "sin comparación todavía" : `${growth.instagram.followersDelta >= 0 ? "+" : ""}${growth.instagram.followersDelta} en el período`} />
                  <MetricTile label="Alcance" value={growth.instagram.reach} helper="cuentas alcanzadas" />
                  <MetricTile label="Visitas al perfil" value={growth.instagram.profileViews} />
                  <MetricTile label="Taps en enlaces" value={growth.instagram.linkTaps} helper="métrica nativa de Meta" />
                  <MetricTile label="Interacciones" value={growth.instagram.totalInteractions} helper="métrica nativa de Meta" />
                  <MetricTile label="Visitas web atribuidas" value={instagramChannel?.visits ?? 0} helper="utm_source=instagram" />
                  <MetricTile label="Leads atribuidos" value={instagramChannel?.leads ?? 0} helper={`${instagramChannel?.confirmed ?? 0} turnos confirmados`} />
                </div>
                <TrendChart
                  points={growth.instagram.series}
                  height={190}
                  series={[{ key: "followers", label: "Seguidores", color: "#db2777" }]}
                  emptyMessage="La evolución aparece al acumular al menos dos snapshots diarios."
                />
              </div>
            )}
            {contentPerformance.available && contentPerformance.rows.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Contenido que llevó personas a la web</p>
                    <p className="text-xs text-gray-500">Atribución del link de seguimiento de historias, bio o Linktree.</p>
                  </div>
                  <Link href="/contenido/instagram" className="text-xs font-semibold text-pink-700 hover:underline">Abrir estudio</Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-b text-left text-xs text-gray-500"><th className="pb-2 font-medium">Pieza</th><th className="pb-2 text-right font-medium">Visitas</th><th className="pb-2 text-right font-medium">Con acción</th><th className="pb-2 text-right font-medium">Tasa</th></tr></thead>
                    <tbody>
                      {contentPerformance.rows.map(row => (
                        <tr key={row.itemId} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-3 text-gray-900"><span className="font-medium">{row.topic}</span><span className="ml-2 text-xs capitalize text-gray-400">{row.format}</span></td>
                          <td className="py-2 text-right text-gray-700">{row.visits}</td>
                          <td className="py-2 text-right text-gray-700">{row.engagedVisits}</td>
                          <td className="py-2 text-right font-semibold text-gray-900">{row.visits > 0 ? Math.round((row.engagedVisits / row.visits) * 100) : 0}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader icon={MapPin} title="Google" />

      {growth.google.available && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-blue-600" /> Google Business y Maps</CardTitle>
            <p className="text-xs text-gray-500">Rendimiento nativo de la ficha, reputación en Google y tráfico que llegó a la web por el enlace medible.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {growth.google.status === "quota_blocked" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Google todavía mantiene la Business Profile Performance API con cuota 0. Las impresiones, llamadas y direcciones nativas se activarán automáticamente cuando Google habilite el acceso; mientras tanto, las visitas y leads desde la ficha sí se miden con <span className="font-mono">/go/google</span>.
              </div>
            )}
            {growth.google.status === "not_connected" && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                Conectá Google Business en <Link href="/google-local" className="font-semibold underline">Google Local</Link> para traer métricas nativas. El enlace medible funciona aunque la API no esté conectada.
              </div>
            )}
            {growth.google.status === null && (
              <p className="text-sm text-gray-400">
                Todavía no hay snapshots. Se generan diariamente dentro del cron de publish-content
                — hace falta al menos una corrida para que este card muestre datos.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <MetricTile label="Impresiones Search" value={growth.google.impressionsSearch} />
              <MetricTile label="Impresiones Maps" value={growth.google.impressionsMaps} />
              <MetricTile label="Clicks al sitio" value={growth.google.websiteClicks} helper="métrica nativa" />
              <MetricTile label="Clicks en llamar" value={growth.google.callClicks} />
              <MetricTile label="Cómo llegar" value={growth.google.directionRequests} />
              <MetricTile label="Visitas web atribuidas" value={googleChannel?.visits ?? 0} helper="utm_source=google_maps" />
              <MetricTile label="Leads atribuidos" value={googleChannel?.leads ?? 0} helper={`${googleChannel?.confirmed ?? 0} turnos`} />
              <MetricTile label="Rating y reseñas" value={growth.google.rating === null ? null : `${growth.google.rating.toFixed(1)} ★`} helper={growth.google.reviewCount === null ? "sin datos" : `${growth.google.reviewCount} reseñas${growth.google.reviewDelta === null ? "" : ` · ${growth.google.reviewDelta >= 0 ? "+" : ""}${growth.google.reviewDelta}`}`} />
            </div>
            {growth.google.series.length > 1 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700"><Star className="h-4 w-4 text-amber-500" /> Evolución de reseñas</div>
                <TrendChart points={growth.google.series} height={180} series={[{ key: "reviews", label: "Reseñas", color: "#d97706" }]} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SectionHeader icon={Clock} title="Reportes" />

      {/* Reportes semanales */}
      {weeklyReports.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reportes semanales</CardTitle>
            <p className="text-xs text-gray-500">
              Snapshot automático generado todos los domingos (leads nuevos, conversión y canales de
              la semana anterior — Lucía revisa los datos ese día). No se envía a ningún lado todavía
              — se guarda acá para consultar.
            </p>
          </CardHeader>
          <CardContent>
            {weeklyReports.rows.length === 0 ? (
              <p className="text-sm text-gray-400">
                Todavía no se generó ningún reporte semanal. El primero se genera el próximo domingo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Semana</th>
                      <th className="pb-2 font-medium text-right">Leads nuevos</th>
                      <th className="pb-2 font-medium text-right">Confirmados</th>
                      <th className="pb-2 font-medium text-right">Conversión</th>
                      <th className="pb-2 font-medium text-right">Visitas landing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyReports.rows.map(report => (
                      <tr key={report.week_start} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-2 text-gray-900">
                          {new Date(report.week_start).toLocaleDateString("es-AR")} – {new Date(report.week_end).toLocaleDateString("es-AR")}
                        </td>
                        <td className="py-2 text-right text-gray-700">{report.metrics.leads_total}</td>
                        <td className="py-2 text-right text-gray-700">{report.metrics.leads_confirmed}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{report.metrics.conversion_rate}%</td>
                        <td className="py-2 text-right text-gray-700">{report.metrics.landing_visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
