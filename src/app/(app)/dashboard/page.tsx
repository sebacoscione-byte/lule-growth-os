import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, CheckCircle2, Clock,
  MapPin, Camera, Search, MessageSquare, Globe, Lightbulb, Eye,
  MousePointerClick, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  CalendarDays, PhoneCall, Navigation, Star, BarChart3, AlertTriangle,
  Megaphone, DollarSign, ChevronDown,
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
  getDashboardDateRange,
  parseDashboardPeriod,
  DASHBOARD_PERIODS,
  type DashboardDateRange,
  type DashboardPeriod,
  type PeriodValue,
} from "@/lib/dashboard-growth"
import { getMetaAdsDashboardMetrics, type MetaAdsStatus } from "@/lib/meta-ads"
import type { ReactNode } from "react"

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
  clickBooking: number
  clickCall: number
  clickWhatsapp: number
  clickMaps: number
}

const CLICK_LOCATION_LABEL: Record<string, string> = {
  cimel: "CIMEL Lanús", swiss: "Swiss Medical Lomas", britanico: "Hospital Británico (Lanús y Central)",
}

// Reemplaza la vieja card "Métricas de landings" (cta_cimel/cta_swiss/cta_britanico/form_submitted),
// que quedó midiendo eventos que ya nadie dispara desde el rediseño del tracking del 2026-07-06 y
// por eso siempre mostraba 0. Esta sí usa los eventos reales (click_call, click_whatsapp +
// location_key). Cubre Swiss Medical y Hospital Británico aunque ninguno de los dos pase por el bot
// de WhatsApp de Lucía -- el click en sí se puede medir igual, lo que no se puede saber es si ese
// contacto externo (Swity, o el teléfono/central de turnos del Británico) terminó en un turno.
async function getClicksByLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  range: DashboardDateRange,
): Promise<{ rows: ClicksByLocationRow[]; available: boolean }> {
  try {
    const { data, error } = await supabase.rpc("dashboard_site_actions_by_location", {
      p_start: range.currentStart,
      p_end: range.currentEnd,
    })
    if (error) throw error

    const byLocation = new Map<string, { booking: number; call: number; whatsapp: number; maps: number }>()
    for (const row of (data ?? []) as { location_key: string; event_type: string; event_count: number | string }[]) {
      const entry = byLocation.get(row.location_key) ?? { booking: 0, call: 0, whatsapp: 0, maps: 0 }
      if (row.event_type === "click_booking") entry.booking = Number(row.event_count)
      else if (row.event_type === "click_call") entry.call = Number(row.event_count)
      else if (row.event_type === "click_whatsapp") entry.whatsapp = Number(row.event_count)
      else if (row.event_type === "click_maps") entry.maps = Number(row.event_count)
      byLocation.set(row.location_key, entry)
    }

    const rows: ClicksByLocationRow[] = (["cimel", "swiss", "britanico"] as const).map(locationKey => {
      const entry = byLocation.get(locationKey) ?? { booking: 0, call: 0, whatsapp: 0, maps: 0 }
      return {
        locationKey,
        locationLabel: CLICK_LOCATION_LABEL[locationKey],
        clickBooking: entry.booking,
        clickCall: entry.call,
        clickWhatsapp: entry.whatsapp,
        clickMaps: entry.maps,
      }
    })

    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

type SiteJourneyRow = {
  source: string
  medium: string
  campaign: string
  content: string | null
  visits: number
  heroVisits: number
  contactVisits: number
  bookingVisits: number
  callVisits: number
  whatsappVisits: number
  mapsVisits: number
  instagramVisits: number
}

type SiteJourney = {
  rows: SiteJourneyRow[]
  totals: Omit<SiteJourneyRow, "source" | "medium" | "campaign" | "content">
  available: boolean
}

async function getSiteJourney(
  supabase: Awaited<ReturnType<typeof createClient>>,
  range: DashboardDateRange,
): Promise<SiteJourney> {
  const emptyTotals = {
    visits: 0, heroVisits: 0, contactVisits: 0, bookingVisits: 0,
    callVisits: 0, whatsappVisits: 0, mapsVisits: 0, instagramVisits: 0,
  }
  try {
    const { data, error } = await supabase.rpc("dashboard_site_journey", {
      p_start: range.currentStart,
      p_end: range.currentEnd,
    })
    if (error) throw error
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
      source: String(row.source ?? "direct"),
      medium: String(row.medium ?? "sin_medium"),
      campaign: String(row.campaign ?? "sin_campana"),
      content: row.content === "sin_contenido" ? null : String(row.content ?? "") || null,
      visits: Number(row.visits) || 0,
      heroVisits: Number(row.hero_visits) || 0,
      contactVisits: Number(row.contact_visits) || 0,
      bookingVisits: Number(row.booking_visits) || 0,
      callVisits: Number(row.call_visits) || 0,
      whatsappVisits: Number(row.whatsapp_visits) || 0,
      mapsVisits: Number(row.maps_visits) || 0,
      instagramVisits: Number(row.instagram_visits) || 0,
    }))
    const totals = rows.reduce((sum, row) => ({
      visits: sum.visits + row.visits,
      heroVisits: sum.heroVisits + row.heroVisits,
      contactVisits: sum.contactVisits + row.contactVisits,
      bookingVisits: sum.bookingVisits + row.bookingVisits,
      callVisits: sum.callVisits + row.callVisits,
      whatsappVisits: sum.whatsappVisits + row.whatsappVisits,
      mapsVisits: sum.mapsVisits + row.mapsVisits,
      instagramVisits: sum.instagramVisits + row.instagramVisits,
    }), emptyTotals)
    return { rows, totals, available: true }
  } catch {
    return { rows: [], totals: emptyTotals, available: false }
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
      .select("referral_code, utm_content, confirmed_booked")
      .or("referral_code.not.is.null,utm_content.not.is.null")
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

type PeriodChannelOverview = {
  available: boolean
  whatsappLeads: number
  whatsappClicks: number
}

function nextDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function getPeriodChannelOverview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  range: DashboardDateRange,
): Promise<PeriodChannelOverview> {
  const from = `${range.currentStart}T00:00:00-03:00`
  const to = `${nextDateKey(range.currentEnd)}T00:00:00-03:00`
  const [whatsappLeads, whatsappClicks] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true })
      .eq("origin_channel", "whatsapp").gte("created_at", from).lt("created_at", to),
    supabase.from("landing_events").select("id", { count: "exact", head: true })
      .eq("event_type", "click_whatsapp").gte("created_at", from).lt("created_at", to),
  ])
  if (whatsappLeads.error || whatsappClicks.error) {
    return { available: false, whatsappLeads: 0, whatsappClicks: 0 }
  }
  return {
    available: true,
    whatsappLeads: whatsappLeads.count ?? 0,
    whatsappClicks: whatsappClicks.count ?? 0,
  }
}

async function getDashboardData(period: DashboardPeriod) {
  const supabase = await createClient()
  const range = getDashboardDateRange(period)

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
    metaAds,
    periodChannelOverview,
    siteJourney,
  ] = await Promise.all([
    getLandingRanking(supabase, period),
    getHeroVariantResults(supabase, period),
    getReferralFunnel(supabase, period),
    getClicksByLocation(supabase, range),
    getInstagramWebClicks(supabase, period),
    getWhatsAppCostSummary(supabase),
    getWeeklyReports(supabase),
    getDashboardGrowthData(supabase, period),
    getContentPerformance(supabase, period),
    getMetaAdsDashboardMetrics(period),
    getPeriodChannelOverview(supabase, range),
    getSiteJourney(supabase, range),
  ])
  const growthRecommendations = await getGrowthRecommendationsData(supabase, landingRanking.rows, heroVariantResults.rows, period)

  return {
    metrics, recentLeads: (recentLeads ?? []) as Lead[],
    landingRanking, heroVariantResults, referralFunnel, clicksByLocation, instagramWebClicks,
    whatsappCostSummary, growthRecommendations, weeklyReports, growth, contentPerformance, metaAds,
    periodChannelOverview, siteJourney,
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

function DashboardDisclosure({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Globe
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden md:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-950 md:text-base">{title}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
          </div>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-gray-100 bg-gray-50/40 p-4 md:p-5">
        {children}
      </div>
    </details>
  )
}

function ChannelSummaryCard({
  icon: Icon,
  title,
  headline,
  detail,
  className,
}: {
  icon: typeof Globe
  title: string
  headline: string
  detail: string
  className: string
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${className}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold text-gray-700">{title}</p>
      </div>
      <p className="mt-3 text-xl font-bold text-gray-950">{headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">{detail}</p>
    </div>
  )
}

function ChannelDisclosure({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Globe
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <details className="group/channel overflow-hidden rounded-xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{description}</p>
          </div>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open/channel:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-gray-100 bg-gray-50/50 p-4">
        {children}
      </div>
    </details>
  )
}

function AdvancedSiteDisclosure({ children }: { children: ReactNode }) {
  return (
    <details className="group/advanced overflow-hidden rounded-xl border border-dashed border-gray-300 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Análisis avanzado del sitio</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
            Desglose por sede y página, recorrido completo y prueba de los botones principales.
          </p>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-open/advanced:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-gray-100 bg-gray-50/50 p-4">
        {children}
      </div>
    </details>
  )
}

function OperationalAction({
  href,
  label,
  value,
  note,
  icon: Icon,
  className,
}: {
  href: string
  label: string
  value: number
  note: string
  icon: typeof Globe
  className: string
}) {
  return (
    <Link href={href} className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${className}`}><Icon className="h-4 w-4" /></span>
        <ArrowUpRight className="h-4 w-4 text-gray-300 transition group-hover:text-gray-600" />
      </div>
      <p className="mt-3 text-2xl font-bold text-gray-950">{value}</p>
      <p className="text-sm font-semibold text-gray-800">{label}</p>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </Link>
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
  comparisonLabel = "vs. período anterior",
}: {
  title: string
  value: number | string
  comparison?: PeriodValue
  icon: typeof Globe
  iconClass: string
  note?: string
  rate?: boolean
  comparisonLabel?: string
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
        <div className="mt-1 min-h-8 space-y-1">
          {note && <p className="text-xs leading-relaxed text-gray-500">{note}</p>}
          {comparison && (
            <div>
              <Comparison value={comparison} rate={rate} />
              <span className="ml-1 text-xs text-gray-400">{comparisonLabel}</span>
            </div>
          )}
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
  direct: { label: "Acceso directo", icon: Globe, className: "bg-gray-100 text-gray-700" },
  manual: { label: "Carga manual", icon: Users, className: "bg-gray-100 text-gray-700" },
}

const ACTION_META: Record<string, { label: string; icon: typeof Globe; className: string }> = {
  click_booking: { label: "Turno online", icon: CalendarDays, className: "bg-indigo-50 text-indigo-700" },
  click_whatsapp: { label: "WhatsApp", icon: MessageSquare, className: "bg-emerald-50 text-emerald-700" },
  click_call: { label: "Llamadas", icon: PhoneCall, className: "bg-sky-50 text-sky-700" },
  click_maps: { label: "Cómo llegar", icon: Navigation, className: "bg-amber-50 text-amber-700" },
}

const META_ADS_STATUS_COPY: Record<Exclude<MetaAdsStatus, "available">, string> = {
  not_configured: "El seguimiento del sitio ya está activo. Falta conectar la cuenta publicitaria para sumar inversión, alcance, impresiones y clics.",
  invalid_configuration: "La configuración de Meta Ads está incompleta o tiene un identificador inválido.",
  provider_rejected: "Meta rechazó la credencial publicitaria. Hay que renovarla o revisar el permiso ads_read.",
  provider_unavailable: "Meta Ads no respondió a tiempo. El seguimiento del sitio sigue funcionando y se volverá a intentar al recargar.",
  invalid_provider_response: "Meta devolvió una respuesta que no se pudo validar. El seguimiento del sitio sigue disponible.",
}

const META_PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  messenger: "Messenger",
  audience_network: "Audience Network",
  sin_desglose: "Sin desglose",
}

function readableTrackingValue(value: string): string {
  if (value === "sin_medium") return "Sin medio"
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function formatAdsMoney(amount: number, currency: string | null): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", ...options })
    .format(new Date(`${dateKey}T12:00:00.000Z`))
}

function formatWeekLabel(range: DashboardDateRange): string {
  const start = new Date(`${range.currentStart}T12:00:00.000Z`)
  const end = new Date(`${range.displayEnd}T12:00:00.000Z`)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  const startLabel = formatDateKey(range.currentStart, sameMonth
    ? { day: "numeric" }
    : { day: "numeric", month: "long" })
  const endLabel = formatDateKey(range.displayEnd, { day: "numeric", month: "long" })
  return `${startLabel} al ${endLabel}`
}

function WeeklySummaryItem({
  icon: Icon,
  title,
  headline,
  detail,
}: {
  icon: typeof Globe
  title: string
  headline: string
  detail: string
}) {
  return (
    <article className="border-t border-white/10 pt-4">
      <div className="flex items-center gap-2 text-indigo-200">
        <Icon className="h-4 w-4" />
        <h3 className="text-xs font-semibold uppercase tracking-wide">{title}</h3>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">{headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">{detail}</p>
    </article>
  )
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
    metaAds, periodChannelOverview, siteJourney,
  } = await getDashboardData(period)

  const maxFunnel = Math.max(growth.summary.visits.current, 1)
  const instagramChannel = growth.channels.find(channel => channel.channel === "instagram")
  const googleChannel = growth.channels.find(channel => channel.channel === "google_maps")
  const range = getDashboardDateRange(period)
  const periodLabel = period === 7
    ? `Semana del ${formatWeekLabel(range)}`
    : period === 365 ? "el último año" : `los últimos ${period} días`
  const comparisonLabel = period === 7 ? "vs. mismos días de la semana anterior" : "vs. período anterior"
  const pendingOperational = metrics.emergencies + metrics.requires_human + metrics.followup_pending
  const platformClicks = metaAds.campaigns.reduce<Record<string, number>>((totals, row) => {
    totals[row.platform] = (totals[row.platform] ?? 0) + row.linkClicks
    return totals
  }, {})
  const platformClickRows = Object.entries(platformClicks).sort((a, b) => b[1] - a[1])
  const topJourneyCampaign = siteJourney.rows.find(row => row.campaign !== "sin_campana")
  const siteContactRate = siteJourney.totals.visits > 0
    ? Math.round((siteJourney.totals.contactVisits / siteJourney.totals.visits) * 1000) / 10
    : 0

  return (
    <div className="space-y-5 bg-gray-50/60 p-4 text-gray-950 md:space-y-7 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Resumen del consultorio</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Una lectura simple de pacientes, canales y publicidad.</p>
        </div>
        <div className="flex w-fit rounded-xl border border-gray-200 bg-white p-1 shadow-sm" aria-label="Período del dashboard">
          {DASHBOARD_PERIODS.map(value => (
            <Link
              key={value}
              href={`/dashboard?period=${value}`}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${period === value ? "bg-gray-950 text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
            >
              {value === 7 ? "Esta semana" : value === 365 ? "1 año" : `${value} días`}
            </Link>
          ))}
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl bg-gray-950 p-4 text-white shadow-sm md:p-6" aria-labelledby="resumen-title">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">Resumen general · {periodLabel}</p>
        <h2 id="resumen-title" className="mt-2 max-w-4xl text-lg font-semibold leading-snug md:text-2xl">
          {growth.available ? (
            <>
              <strong>{growth.summary.visits.current}</strong> personas llegaron al sitio, <strong>{growth.summary.engagedVisits.current}</strong> hicieron
              una acción para contactarse, <strong>{growth.summary.leads.current}</strong> consultas quedaron registradas y <strong>{growth.summary.confirmed.current}</strong> confirmaron que pidieron turno.
            </>
          ) : (
            <>El seguimiento de visitas todavía no está disponible; la información operativa y publicitaria continúa funcionando.</>
          )}
        </h2>
        {period === 7 && (
          <p className="mt-3 text-xs text-gray-400">
            Datos acumulados hasta {formatDateKey(range.currentEnd, { weekday: "long", day: "numeric", month: "long" }).replace(",", "")}.
          </p>
        )}
        <div className="mt-5 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-4">
          <WeeklySummaryItem
            icon={Camera}
            title="Instagram"
            headline={growth.instagram.followersDelta === null
              ? growth.instagram.followers === null ? "Sin datos todavía" : `${growth.instagram.followers} seguidores`
              : growth.instagram.followersDelta > 0 ? `+${growth.instagram.followersDelta} seguidores`
              : growth.instagram.followersDelta < 0 ? `${growth.instagram.followersDelta} seguidores`
              : "Sin cambios en seguidores"}
            detail={growth.instagram.followers === null
              ? "La cuenta está conectada, pero todavía falta una comparación diaria."
              : `${growth.instagram.followers} seguidores totales${growth.instagram.profileViews === null ? "" : ` · ${growth.instagram.profileViews} visitas al perfil`}.`}
          />
          <WeeklySummaryItem
            icon={Megaphone}
            title="Publicidad"
            headline={metaAds.status === "available"
              ? `${formatAdsMoney(metaAds.totals.spend, metaAds.currency)} invertidos`
              : "Sin datos publicitarios"}
            detail={metaAds.status === "available"
              ? `${metaAds.totals.linkClicks} clics al sitio · ${metaAds.totals.impressions.toLocaleString("es-AR")} impresiones.`
              : "El resto del resumen sigue funcionando aunque Meta no responda."}
          />
          <WeeklySummaryItem
            icon={Star}
            title="Google"
            headline={growth.google.reviewCount === null
              ? "Sin datos de reseñas"
              : growth.google.reviewDelta && growth.google.reviewDelta > 0
                ? `+${growth.google.reviewDelta} reseñas`
                : `${growth.google.reviewCount} reseñas totales`}
            detail={growth.google.rating === null
              ? "Google todavía no informó una calificación."
              : `${growth.google.rating.toFixed(1)} de calificación${growth.google.directionRequests === null ? "" : ` · ${growth.google.directionRequests} solicitudes de cómo llegar`}.`}
          />
          <WeeklySummaryItem
            icon={MessageSquare}
            title="WhatsApp"
            headline={periodChannelOverview.available
              ? `${periodChannelOverview.whatsappLeads} consultas registradas`
              : "Sin datos del canal"}
            detail={periodChannelOverview.available
              ? `${periodChannelOverview.whatsappClicks} clics a WhatsApp desde el sitio.`
              : "No se pudo leer el movimiento de WhatsApp para este período."}
          />
        </div>
      </section>

      <section aria-labelledby="operacion-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
              <h2 id="operacion-title" className="text-sm font-semibold text-gray-950">Para revisar hoy</h2>
              <p className="text-xs text-gray-500">Tareas que pueden necesitar una acción del equipo.</p>
          </div>
          <Link href="/leads" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Ver todas las consultas</Link>
        </div>
        {pendingOperational === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">No hay tareas urgentes pendientes.</p>
            <p className="mt-1 text-xs text-emerald-700">No se detectaron alertas, consultas esperando respuesta humana ni seguimientos vencidos.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <OperationalAction href="/leads?possible_emergency=true" label="Alertas para revisar" value={metrics.emergencies} note="Casos marcados para atención inmediata." icon={AlertTriangle} className="bg-red-50 text-red-700" />
            <OperationalAction href="/leads?requires_human=true" label="Necesitan respuesta" value={metrics.requires_human} note="Conversaciones que requieren intervención del equipo." icon={MessageSquare} className="bg-orange-50 text-orange-700" />
            <OperationalAction href="/leads?status=seguimiento_pendiente" label="Seguimientos pendientes" value={metrics.followup_pending} note="Personas a las que corresponde volver a contactar." icon={Clock} className="bg-amber-50 text-amber-700" />
          </div>
        )}
      </section>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Llegaron al sitio" value={growth.available ? growth.summary.visits.current : "—"} comparison={growth.available ? growth.summary.visits : undefined} comparisonLabel={comparisonLabel} note="Personas que abrieron alguna página pública." icon={Eye} iconClass="bg-indigo-50 text-indigo-700" />
        <KpiCard title="Intentaron contactarse" value={growth.available ? growth.summary.engagedVisits.current : "—"} comparison={growth.available ? growth.summary.engagedVisits : undefined} comparisonLabel={comparisonLabel} note="Tocaron turno, WhatsApp, llamada o cómo llegar." icon={MousePointerClick} iconClass="bg-cyan-50 text-cyan-700" />
        <KpiCard title="Consultas registradas" value={growth.available ? growth.summary.leads.current : "—"} comparison={growth.available ? growth.summary.leads : undefined} comparisonLabel={comparisonLabel} note="Personas identificadas para seguimiento." icon={Users} iconClass="bg-violet-50 text-violet-700" />
        <KpiCard title="Turnos confirmados" value={growth.available ? growth.summary.confirmed.current : "—"} comparison={growth.available ? growth.summary.confirmed : undefined} comparisonLabel={comparisonLabel} note="Personas que confirmaron haber solicitado turno." icon={CheckCircle2} iconClass="bg-emerald-50 text-emerald-700" />
      </div>

      {!growth.available && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          La nueva serie temporal todavía no está disponible. Se habilita al aplicar la migración de métricas; el resto del dashboard sigue operativo.
        </div>
      )}

      <DashboardDisclosure
        icon={TrendingUp}
        title="Cómo avanzan las personas hasta pedir turno"
        description="Abrí esta sección para ver la evolución diaria, las tasas y qué canal trae más consultas."
      >
      {/* Evolución + embudo */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-indigo-600" /> Evolución del recorrido</CardTitle>
            <p className="text-xs text-gray-500">Datos diarios de los últimos {period === 365 ? "12 meses" : `${period} días`}. Los turnos se cuentan según la fecha de la primera consulta.</p>
          </CardHeader>
          <CardContent>
            <TrendChart
              points={growth.trend}
              series={[
                { key: "visits", label: "Visitas", color: "#4f46e5" },
                { key: "engagedVisits", label: "Con acción", color: "#0891b2" },
                { key: "leads", label: "Consultas", color: "#7c3aed" },
                { key: "confirmed", label: "Turnos", color: "#059669" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recorrido del período</CardTitle>
            <p className="text-xs text-gray-500">Personas, no cantidad de botones tocados.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: "Visitas", value: growth.summary.visits.current, color: "bg-indigo-500" },
              { label: "Hicieron una acción", value: growth.summary.engagedVisits.current, color: "bg-cyan-500" },
              { label: "Quedaron como consulta", value: growth.summary.leads.current, color: "bg-violet-500" },
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
              <MetricTile label="Visita → consulta" value={`${growth.summary.visitToLeadRate.current}%`} />
              <MetricTile label="Consulta → turno" value={`${growth.summary.leadToConfirmedRate.current}%`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Canales del período */}
      {growth.channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">De dónde llegan las consultas</CardTitle>
            <p className="text-xs text-gray-500">Compara las visitas, consultas y turnos que llegaron desde cada canal.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-3 font-medium">Canal</th>
                    <th className="pb-3 text-right font-medium">Visitas</th>
                    <th className="pb-3 text-right font-medium">Consultas</th>
                    <th className="pb-3 text-right font-medium">Visita → consulta</th>
                    <th className="pb-3 text-right font-medium">Turnos</th>
                    <th className="pb-3 text-right font-medium">Consulta → turno</th>
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
      </DashboardDisclosure>

      <SectionHeader icon={Megaphone} title="Campañas y publicidad" />

      <DashboardDisclosure
        icon={Megaphone}
        title="Qué pasó después de cada campaña"
        description="Relaciona cada enlace publicitario con las consultas y turnos que luego quedaron registrados."
      >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-fuchsia-600" />
            Resultados después del clic
          </CardTitle>
          <p className="text-xs text-gray-500">
            Sigue el recorrido desde que una persona abre el enlace hasta que su consulta o turno queda registrado.
            Incluye datos históricos aunque el panel se haya agregado después de publicar la campaña.
          </p>
        </CardHeader>
        <CardContent>
          {growth.campaigns.length === 0 ? (
            <p className="text-sm text-gray-400">
              Todavía no hay visitas identificadas para una campaña en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-3 font-medium">Campaña / contenido</th>
                    <th className="pb-3 font-medium">Origen</th>
                    <th className="pb-3 text-right font-medium">Visitas</th>
                    <th className="pb-3 text-right font-medium">Intentaron contactarse</th>
                    <th className="pb-3 text-right font-medium">Consultas</th>
                    <th className="pb-3 text-right font-medium">Visita → consulta</th>
                    <th className="pb-3 text-right font-medium">Turnos</th>
                    <th className="pb-3 text-right font-medium">Consulta → turno</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.campaigns.map(row => (
                    <tr
                      key={`${row.source}:${row.medium}:${row.campaign}:${row.content ?? ""}`}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-semibold text-gray-900">{readableTrackingValue(row.campaign)}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {row.content ? readableTrackingValue(row.content) : "Sin variante de contenido"}
                          {row.firstSeen && row.lastSeen ? ` · ${new Date(`${row.firstSeen}T12:00:00`).toLocaleDateString("es-AR")}–${new Date(`${row.lastSeen}T12:00:00`).toLocaleDateString("es-AR")}` : ""}
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-700">{readableTrackingValue(row.source)}</p>
                        <p className="text-xs text-gray-400">{readableTrackingValue(row.medium)}</p>
                      </td>
                      <td className="py-3 text-right text-gray-700">{row.visits}</td>
                      <td className="py-3 text-right text-cyan-700">
                        <span className="font-semibold">{row.engagedVisits}</span>
                        <span className="ml-1 text-xs text-gray-400">({row.visitToActionRate}%)</span>
                      </td>
                      <td className="py-3 text-right font-semibold text-violet-700">{row.leads}</td>
                      <td className="py-3 text-right text-gray-700">{row.visitToLeadRate}%</td>
                      <td className="py-3 text-right font-semibold text-emerald-700">{row.confirmed}</td>
                      <td className="py-3 text-right text-gray-700">{row.leadToConfirmedRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            “Intentaron contactarse” cuenta personas que tocaron turno online, llamada, WhatsApp o cómo llegar;
            no suma varias veces a la misma visita. El detalle técnico de origen del enlace se conserva para auditoría.
          </p>
        </CardContent>
      </Card>
      </DashboardDisclosure>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-emerald-600" />
            Publicidad en Facebook e Instagram
          </CardTitle>
          <p className="text-xs text-gray-500">
            Cuánto se gastó y cuántas visitas generaron los anuncios durante {periodLabel.toLocaleLowerCase("es-AR")}.
          </p>
        </CardHeader>
        <CardContent>
          {metaAds.status !== "available" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">Integración publicitaria pendiente</p>
              <p className="mt-1">{META_ADS_STATUS_COPY[metaAds.status]}</p>
              <p className="mt-2 text-xs text-amber-700">
                Esto no afecta la campaña en circulación ni el seguimiento propio del sitio.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile label="Gastado" value={formatAdsMoney(metaAds.totals.spend, metaAds.currency)} helper="Inversión acumulada en el período" />
                <MetricTile label="Veces que se mostró" value={metaAds.totals.impressions.toLocaleString("es-AR")} helper="Una persona puede verlo más de una vez" />
                <MetricTile label="Clics hacia el sitio" value={metaAds.totals.linkClicks.toLocaleString("es-AR")} helper="No equivale todavía a una consulta" />
                <MetricTile label="Costo por clic" value={metaAds.totals.costPerLinkClick === null ? null : formatAdsMoney(metaAds.totals.costPerLinkClick, metaAds.currency)} helper="Promedio pagado por cada clic" />
              </div>

              {metaAds.totals.linkClicks > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
                  <p className="font-semibold">Lectura rápida</p>
                  <p className="mt-1">
                    Meta registró <strong>{metaAds.totals.linkClicks} clics</strong> con una inversión de <strong>{formatAdsMoney(metaAds.totals.spend, metaAds.currency)}</strong>.
                    {platformClickRows.length > 1 && (
                      <> {META_PLATFORM_LABEL[platformClickRows[0][0]] ?? readableTrackingValue(platformClickRows[0][0])} aportó {platformClickRows[0][1]} clics y {META_PLATFORM_LABEL[platformClickRows[1][0]] ?? readableTrackingValue(platformClickRows[1][0])} {platformClickRows[1][1]}.</>
                    )}
                    {growth.available && <> Más arriba podés comparar esos clics con las <strong>{growth.summary.leads.current} consultas registradas</strong> y los <strong>{growth.summary.confirmed.current} turnos confirmados</strong>.</>}
                  </p>
                </div>
              )}

              {metaAds.campaigns.length === 0 ? (
                <p className="text-sm text-gray-400">Meta no registró actividad publicitaria en este período.</p>
              ) : (
                <details className="group rounded-xl border border-gray-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-gray-800 marker:hidden">
                    Ver desglose por plataforma y campaña
                    <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
                  </summary>
                <div className="overflow-x-auto border-t border-gray-100 p-4">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="pb-3 font-medium">Campaña</th>
                        <th className="pb-3 font-medium">Plataforma</th>
                        <th className="pb-3 text-right font-medium">Inversión</th>
                        <th className="pb-3 text-right font-medium">Impresiones</th>
                        <th className="pb-3 text-right font-medium">Alcance</th>
                        <th className="pb-3 text-right font-medium">Clics</th>
                        <th className="pb-3 text-right font-medium">CTR enlace</th>
                        <th className="pb-3 text-right font-medium">Costo/clic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaAds.campaigns.map(row => (
                        <tr key={`${row.campaignId}:${row.platform}`} className="border-b border-gray-50 last:border-0">
                          <td className="py-3 pr-4 font-medium text-gray-900">{row.campaignName}</td>
                          <td className="py-3 pr-4 text-gray-700">{META_PLATFORM_LABEL[row.platform] ?? readableTrackingValue(row.platform)}</td>
                          <td className="py-3 text-right font-semibold text-gray-900">{formatAdsMoney(row.spend, metaAds.currency)}</td>
                          <td className="py-3 text-right text-gray-700">{row.impressions.toLocaleString("es-AR")}</td>
                          <td className="py-3 text-right text-gray-700">{row.reach.toLocaleString("es-AR")}</td>
                          <td className="py-3 text-right text-gray-700">{row.linkClicks.toLocaleString("es-AR")}</td>
                          <td className="py-3 text-right text-gray-700">{row.linkCtr}%</td>
                          <td className="py-3 text-right text-gray-700">{row.costPerLinkClick === null ? "—" : formatAdsMoney(row.costPerLinkClick, metaAds.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </details>
              )}
              <p className="text-[11px] leading-relaxed text-gray-400">
                Los datos publicitarios vienen directamente de Meta. La app sólo lee resultados agregados y no envía información de pacientes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recomendaciones de crecimiento */}
      {growthRecommendations.available && growthRecommendations.recommendations.length > 0 && (
        <DashboardDisclosure
          icon={Lightbulb}
          title="Sugerencias para mejorar"
          description="Avisos automáticos para revisar cuando quieras optimizar el sitio, Instagram, Google o WhatsApp."
        >
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Sugerencias automáticas
            </CardTitle>
            <p className="text-xs text-gray-500">
              Se calculan con los datos disponibles. No realizan cambios automáticos.
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
        </DashboardDisclosure>
      )}

      <DashboardDisclosure
        icon={BarChart3}
        title="Ver información detallada por canal"
        description="Primero, una lectura rápida. Abrí un canal sólo cuando necesites entender de dónde salió cada número."
      >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Vista rápida por canal · {periodLabel}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ChannelSummaryCard
            icon={Globe}
            title="Sitio"
            headline={growth.available ? `${growth.summary.visits.current} visitas` : "Sin datos todavía"}
            detail={growth.available
              ? `${growth.summary.engagedVisits.current} ${growth.summary.engagedVisits.current === 1 ? "persona intentó" : "personas intentaron"} contactarse · ${growth.summary.leads.current} consultas registradas.`
              : "El seguimiento del sitio no respondió para este período."}
            className="bg-indigo-50 text-indigo-700"
          />
          <ChannelSummaryCard
            icon={Camera}
            title="Instagram"
            headline={growth.instagram.followersDelta === null
              ? growth.instagram.followers === null ? "Sin datos todavía" : `${growth.instagram.followers} seguidores`
              : growth.instagram.followersDelta > 0 ? `+${growth.instagram.followersDelta} seguidores`
              : growth.instagram.followersDelta < 0 ? `${growth.instagram.followersDelta} seguidores`
              : "Sin cambios"}
            detail={growth.instagram.followers === null
              ? "Todavía falta una comparación diaria."
              : `${growth.instagram.followers} seguidores totales · ${instagramChannel?.leads ?? 0} consultas identificadas desde Instagram.`}
            className="bg-pink-50 text-pink-700"
          />
          <ChannelSummaryCard
            icon={MapPin}
            title="Google"
            headline={growth.google.reviewCount === null ? "Sin datos de reseñas" : `${growth.google.reviewCount} reseñas`}
            detail={growth.google.rating === null
              ? `${googleChannel?.leads ?? 0} consultas identificadas desde Google.`
              : `${growth.google.rating.toFixed(1)} de calificación · ${googleChannel?.leads ?? 0} consultas identificadas.`}
            className="bg-blue-50 text-blue-700"
          />
          <ChannelSummaryCard
            icon={MessageSquare}
            title="WhatsApp"
            headline={periodChannelOverview.available ? `${periodChannelOverview.whatsappLeads} consultas` : "Sin datos todavía"}
            detail={periodChannelOverview.available
              ? `${periodChannelOverview.whatsappClicks} clics desde el sitio durante el período.`
              : "No se pudo leer el movimiento de este canal."}
            className="bg-emerald-50 text-emerald-700"
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
          “Identificadas” significa que el enlace conservó el origen. Puede haber consultas sin origen cuando una persona escribe directamente.
        </p>
      </div>

      <div className="space-y-3">
      <ChannelDisclosure
        icon={Globe}
        title="Sitio y pacientes"
        description="Visitas, intentos de contacto, consultas, turnos y páginas que generan más interés."
      >
      <SectionHeader icon={Users} title="Consultas y pacientes" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Por canal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">De dónde llegaron las consultas</CardTitle>
            <p className="text-xs text-gray-500">Total acumulado desde que comenzó el registro, no sólo del período seleccionado.</p>
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
            <CardTitle className="text-base">Consultas recientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentLeads.length === 0 && (
              <p className="text-sm text-gray-400">No hay consultas todavía</p>
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

      <SectionHeader icon={Globe} title="Sitio web y páginas" />

      {/* Acciones web del período */}
      <Card>
        <CardHeader>
            <CardTitle className="text-base">Cómo intentaron contactarse desde el sitio</CardTitle>
            <p className="text-xs text-gray-500">Clics en los botones para pedir turno durante el período seleccionado. Una misma persona puede usar más de un botón.</p>
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

      {siteJourney.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Qué hicieron después de entrar</CardTitle>
            <p className="text-xs text-gray-500">
              Se cuentan personas distintas por pestaña durante {periodLabel.toLocaleLowerCase("es-AR")}; un clic del anuncio no siempre termina en una visita medida.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Llegaron al sitio", value: siteJourney.totals.visits, helper: "La página cargó correctamente", className: "bg-indigo-50 text-indigo-700" },
                { label: "Vieron cómo pedir turno", value: siteJourney.totals.heroVisits, helper: "Llegaron a las opciones de sede", className: "bg-blue-50 text-blue-700" },
                { label: "Abrieron un canal oficial", value: siteJourney.totals.contactVisits, helper: `${siteContactRate}% de las visitas`, className: "bg-cyan-50 text-cyan-700" },
                { label: "Quedaron como consulta", value: growth.summary.leads.current, helper: "Personas identificadas para seguimiento", className: "bg-violet-50 text-violet-700" },
              ].map((step, index) => (
                <div key={step.label} className="rounded-xl border border-gray-100 p-4">
                  <span className={`mb-3 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${step.className}`}>{index + 1}</span>
                  <p className="text-2xl font-bold text-gray-950">{step.value}</p>
                  <p className="text-sm font-semibold text-gray-700">{step.label}</p>
                  <p className="mt-1 text-xs text-gray-400">{step.helper}</p>
                </div>
              ))}
            </div>

            {siteJourney.totals.visits >= 50 && siteContactRate < 2 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
                <p className="font-semibold">La principal caída ocurre antes de elegir un canal</p>
                <p className="mt-1">
                  La página recibe tráfico, pero menos del 2% abre turnos, teléfono, WhatsApp o Maps. Esto apunta a una dificultad en el recorrido o a visitantes con baja intención, no a un enlace roto.
                </p>
              </div>
            )}

            {topJourneyCampaign && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
                <p className="font-semibold">Campaña con más visitas: {readableTrackingValue(topJourneyCampaign.campaign)}</p>
                <p className="mt-1">
                  <strong>{topJourneyCampaign.visits}</strong> llegaron, <strong>{topJourneyCampaign.heroVisits}</strong> vieron las opciones de sede y <strong>{topJourneyCampaign.contactVisits}</strong> abrieron un canal oficial
                  {topJourneyCampaign.contactVisits > 0 && (
                    <> ({[
                      topJourneyCampaign.bookingVisits > 0 && `${topJourneyCampaign.bookingVisits} turno online`,
                      topJourneyCampaign.whatsappVisits > 0 && `${topJourneyCampaign.whatsappVisits} WhatsApp`,
                      topJourneyCampaign.callVisits > 0 && `${topJourneyCampaign.callVisits} llamada`,
                      topJourneyCampaign.mapsVisits > 0 && `${topJourneyCampaign.mapsVisits} cómo llegar`,
                    ].filter(Boolean).join(" · ")})</>
                  )}.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {clicksByLocation.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A qué sede intentaron dirigirse</CardTitle>
            <p className="text-xs text-gray-500">
              Cada salida se asocia con el botón de la sede elegida. Hospital Británico agrupa Lanús y Central porque hoy ambos usan la misma etiqueta de medición.
            </p>
          </CardHeader>
          <CardContent>
            {clicksByLocation.rows.every(row => row.clickBooking === 0 && row.clickCall === 0 && row.clickWhatsapp === 0 && row.clickMaps === 0) ? (
              <p className="text-sm text-gray-400">Todavía nadie abrió un canal desde una sede en este período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Sede</th>
                      <th className="pb-2 font-medium text-right">Turno online</th>
                      <th className="pb-2 font-medium text-right">WhatsApp</th>
                      <th className="pb-2 font-medium text-right">Llamada</th>
                      <th className="pb-2 font-medium text-right">Cómo llegar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clicksByLocation.rows.map(row => (
                      <tr key={row.locationKey} className="border-b border-gray-50 last:border-0">
                        <td className="py-3 pr-2 font-medium text-gray-900">{row.locationLabel}</td>
                        <td className="py-3 text-right text-gray-700">{row.clickBooking}</td>
                        <td className="py-3 text-right text-gray-700">{row.clickWhatsapp}</td>
                        <td className="py-3 text-right text-gray-700">{row.clickCall}</td>
                        <td className="py-3 text-right text-gray-700">{row.clickMaps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
              La app puede medir qué canal se abrió, pero Swiss y Hospital Británico administran sus propios turnos: no podemos confirmar desde aquí si la persona terminó la gestión.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Ranking de landings */}
      {landingRanking.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Páginas que más ayudan a iniciar un contacto</CardTitle>
            <p className="text-xs text-gray-500">
              Visitas e interacciones con los botones de pedir turno (últimos {period}{" "}días). El porcentaje
              muestra cuántas visitas hicieron clic en pedir turno online, llamar,
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
                      <th className="pb-2 font-medium text-right">Intentos de contacto</th>
                      <th className="pb-2 font-medium text-right">Porcentaje</th>
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

      <AdvancedSiteDisclosure>

      {/* Clicks al link de confianza de Instagram desde la web (PR #104, sin card hasta ahora) */}
      {instagramWebClicks.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personas que fueron del sitio a Instagram</CardTitle>
            <p className="text-xs text-gray-500">
              Clics en el enlace a Instagram durante los últimos {period}{" "}días. Es una señal de interés,
              pero no significa que la persona haya pedido turno.
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
            <CardTitle className="text-base">Del ingreso a la consulta, página por página</CardTitle>
            <p className="text-xs text-gray-500">
              Muestra el recorrido visita → clic a WhatsApp → consulta → turno confirmado
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
                          { label: "Consultas atribuidas", value: landing.leads, className: "text-violet-700" },
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
                              <strong className="text-violet-700">{destination.leads}</strong> consultas
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
                  WhatsApp pero no envía el mensaje, o borra el código, queda el clic pero no la consulta atribuida.
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
            <CardTitle className="text-base">Prueba de los botones principales del sitio</CardTitle>
            <p className="text-xs text-gray-500">
              Se comparan dos portadas: una destaca &quot;Pedir turno&quot; y la otra &quot;Ver sedes y horarios&quot;.
              Cada visitante ve una de las dos al azar durante los últimos {period} días.
            </p>
            <p className="text-xs text-gray-500">
              Para tomar una decisión hacen falta al menos {AB_TEST_MIN_VISITS_PER_VARIANT} visitas en cada versión
              y una diferencia de {AB_TEST_MIN_RATE_GAP} puntos. Antes de eso, el resultado es sólo orientativo.
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
                        <th className="pb-2 font-medium text-right">Clic en &quot;Pedir turno&quot;</th>
                        <th className="pb-2 font-medium text-right">Clic en &quot;Ver sedes&quot;</th>
                        <th className="pb-2 font-medium text-right">Intentos de contacto</th>
                        <th className="pb-2 font-medium text-right">Porcentaje</th>
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

      </AdvancedSiteDisclosure>

      </ChannelDisclosure>

      <ChannelDisclosure
        icon={MessageSquare}
        title="WhatsApp"
        description="Cuántas personas llegaron por este canal y cuánto cuestan los mensajes enviados."
      >

      {/* Costo de WhatsApp (mismo cálculo que /costos, resumen liviano) */}
      {whatsappCostSummary.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Costo de los mensajes enviados</CardTitle>
            <p className="text-xs text-gray-500">
              Total cobrado por WhatsApp en los mensajes que envió el sistema. El detalle por persona
              y tipo de seguimiento está en <Link href="/costos" className="font-semibold underline">Costos</Link>.
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

      {!whatsappCostSummary.available && (
        <p className="text-sm text-gray-500">Todavía no hay costos de WhatsApp disponibles para mostrar.</p>
      )}
      </ChannelDisclosure>

      <ChannelDisclosure
        icon={Camera}
        title="Instagram"
        description="Seguidores, alcance, visitas al perfil y contenido que llevó personas al sitio."
      >

      {growth.instagram.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4 text-pink-600" /> Qué pasó en Instagram
            </CardTitle>
            <p className="text-xs text-gray-500">Datos de Instagram más las visitas y consultas que llegaron por el enlace de la bio.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {growth.instagram.followers === null ? (
              <p className="text-sm text-gray-400">
                Todavía no hay registros diarios. Hace falta Instagram conectado y al menos una actualización automática.
              </p>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetricTile label="Seguidores" value={growth.instagram.followers} helper={growth.instagram.followersDelta === null ? "sin comparación todavía" : `${growth.instagram.followersDelta >= 0 ? "+" : ""}${growth.instagram.followersDelta} en el período`} />
                  <MetricTile label="Alcance" value={growth.instagram.reach} helper="cuentas alcanzadas" />
                  <MetricTile label="Visitas al perfil" value={growth.instagram.profileViews} />
                  <MetricTile label="Toques en el enlace" value={growth.instagram.linkTaps} helper="informado por Instagram" />
                  <MetricTile label="Interacciones" value={growth.instagram.totalInteractions} helper="me gusta, comentarios y guardados" />
                  <MetricTile label="Visitas al sitio identificadas" value={instagramChannel?.visits ?? 0} helper="llegaron desde Instagram" />
                  <MetricTile label="Consultas identificadas" value={instagramChannel?.leads ?? 0} helper={`${instagramChannel?.confirmed ?? 0} turnos confirmados`} />
                </div>
                <TrendChart
                  points={growth.instagram.series}
                  height={190}
                  series={[{ key: "followers", label: "Seguidores", color: "#db2777" }]}
                  emptyMessage="La evolución aparece al acumular al menos dos registros diarios."
                />
              </div>
            )}
            {contentPerformance.available && contentPerformance.rows.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Contenido que llevó personas al sitio</p>
                    <p className="text-xs text-gray-500">Historias o publicaciones cuyo enlace permitió reconocer el origen.</p>
                  </div>
                  <Link href="/contenido/instagram" className="text-xs font-semibold text-pink-700 hover:underline">Abrir estudio</Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-b text-left text-xs text-gray-500"><th className="pb-2 font-medium">Contenido</th><th className="pb-2 text-right font-medium">Visitas al sitio</th><th className="pb-2 text-right font-medium">Intentaron contactarse</th><th className="pb-2 text-right font-medium">Porcentaje</th></tr></thead>
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

      {!growth.instagram.available && (
        <p className="text-sm text-gray-500">Instagram todavía no tiene información disponible para este período.</p>
      )}
      </ChannelDisclosure>

      <ChannelDisclosure
        icon={MapPin}
        title="Google"
        description="Reseñas, visibilidad en Maps y Search, llamadas, visitas al sitio y consultas identificadas."
      >

      {growth.google.available && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-blue-600" /> Qué pasó en Google</CardTitle>
            <p className="text-xs text-gray-500">Cuántas veces apareció la ficha, qué hicieron las personas y cuántas consultas pudimos identificar.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {growth.google.status === "quota_blocked" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Google todavía no habilitó sus métricas completas. Mientras tanto, las visitas y consultas desde la ficha sí se miden mediante el enlace configurado.
              </div>
            )}
            {growth.google.status === "not_connected" && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                Conectá Google Business en <Link href="/google-local" className="font-semibold underline">Google Local</Link> para traer métricas nativas. El enlace medible funciona aunque la API no esté conectada.
              </div>
            )}
            {growth.google.status === null && (
              <p className="text-sm text-gray-400">
                Todavía no hay registros diarios. Se generan automáticamente una vez por día
                y hace falta al menos una actualización para mostrar resultados.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <MetricTile label="Apariciones en búsquedas" value={growth.google.impressionsSearch} />
              <MetricTile label="Apariciones en Maps" value={growth.google.impressionsMaps} />
              <MetricTile label="Clics al sitio" value={growth.google.websiteClicks} />
              <MetricTile label="Clics en llamar" value={growth.google.callClicks} />
              <MetricTile label="Cómo llegar" value={growth.google.directionRequests} />
              <MetricTile label="Visitas al sitio identificadas" value={googleChannel?.visits ?? 0} helper="llegaron desde Google Maps" />
              <MetricTile label="Consultas identificadas" value={googleChannel?.leads ?? 0} helper={`${googleChannel?.confirmed ?? 0} turnos`} />
              <MetricTile label="Calificación" value={growth.google.rating === null ? null : `${growth.google.rating.toFixed(1)} ★`} helper={growth.google.reviewCount === null ? "sin datos" : `${growth.google.reviewCount} reseñas${growth.google.reviewDelta === null ? "" : ` · ${growth.google.reviewDelta >= 0 ? "+" : ""}${growth.google.reviewDelta}`}`} />
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

      {!growth.google.available && (
        <p className="text-sm text-gray-500">Google todavía no tiene información disponible para este período.</p>
      )}
      </ChannelDisclosure>

      <ChannelDisclosure
        icon={Clock}
        title="Historial semanal"
        description="Compará semanas anteriores sin mezclar esos datos con la lectura del período actual."
      >

      {/* Reportes semanales */}
      {weeklyReports.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reportes semanales</CardTitle>
            <p className="text-xs text-gray-500">
              Resumen automático generado todos los domingos con las consultas, turnos y canales de
              la semana anterior. No se envía: queda guardado acá para consultar.
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
                      <th className="pb-2 font-medium text-right">Consultas nuevas</th>
                      <th className="pb-2 font-medium text-right">Confirmados</th>
                      <th className="pb-2 font-medium text-right">Conversión</th>
                      <th className="pb-2 font-medium text-right">Visitas al sitio</th>
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
      {!weeklyReports.available && (
        <p className="text-sm text-gray-500">El historial semanal todavía no está disponible.</p>
      )}
      </ChannelDisclosure>
      </div>
      </DashboardDisclosure>
    </div>
  )
}
