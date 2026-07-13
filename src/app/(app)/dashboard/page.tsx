import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, CheckCircle2, AlertTriangle, Clock,
  MapPin, Camera, Search, MessageSquare, Globe, Lightbulb, DollarSign, Eye
} from "lucide-react"
import { STATUS_LABELS, STATUS_COLORS, type Lead } from "@/types"
import { timeAgo } from "@/lib/utils"
import { LANDING_DATA, PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"
import { allReferralCodes } from "@/lib/landing-referral-codes"
import { readAutoPublishSettings } from "@/lib/content-pipeline"
import { getGooglePlaceReviews } from "@/lib/google-places"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { getWhatsAppCostSummary } from "@/lib/whatsapp-cost-tracking"
import {
  buildGrowthRecommendations, evaluateAbTestReadiness,
  AB_TEST_MIN_VISITS_PER_VARIANT, AB_TEST_MIN_RATE_GAP,
  type GrowthRecommendation, type RecommendationChannel,
} from "@/lib/growth-recommendations"
import Link from "next/link"

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
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: LandingRankingRow[]; available: boolean }> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc("landing_events_ranking", { p_since: ninetyDaysAgo })
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
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: ClicksByLocationRow[]; available: boolean }> {
  try {
    const { data, error } = await supabase.rpc("landing_clicks_by_location", { p_days: 90 })
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

type InstagramFollowerTrend = {
  current: number
  deltaLast7Days: number | null
  deltaLast30Days: number | null
  firstSnapshotAt: string | null
}

// Snapshot diario (ver src/lib/instagram-followers.ts, corre dentro del cron de publish-content).
// Sin datos todavía -- p. ej. recién agregado, o Instagram nunca se conectó -- muestra el mismo
// placeholder honesto que Google Analytics/Places: no rompe nada, solo no hay nada que mostrar.
async function getInstagramFollowerTrend(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ trend: InstagramFollowerTrend | null; available: boolean }> {
  try {
    const { data, error } = await supabase
      .from("instagram_follower_snapshots")
      .select("captured_on, followers_count")
      .order("captured_on", { ascending: false })
      .limit(31)
    if (error) throw error

    const rows = (data ?? []) as { captured_on: string; followers_count: number }[]
    if (rows.length === 0) return { trend: null, available: true }

    const current = rows[0].followers_count
    const findClosestTo = (daysAgo: number) => {
      const target = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const older = rows.find(r => r.captured_on <= target)
      return older ? older.followers_count : null
    }
    const sevenDaysAgo = findClosestTo(7)
    const thirtyDaysAgo = findClosestTo(30)

    return {
      trend: {
        current,
        deltaLast7Days: sevenDaysAgo !== null ? current - sevenDaysAgo : null,
        deltaLast30Days: thirtyDaysAgo !== null ? current - thirtyDaysAgo : null,
        firstSnapshotAt: rows[rows.length - 1].captured_on,
      },
      available: true,
    }
  } catch {
    return { trend: null, available: false }
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
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: HeroVariantRow[]; available: boolean }> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.rpc("landing_hero_variant_results", { p_since: ninetyDaysAgo })
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

type ReferralFunnelRow = {
  code: string
  landingSlug: string
  locationLabel: string
  specialty: string
  visits: number
  whatsappClicks: number
  leads: number
  confirmed: number
}

const REFERRAL_SPECIALTY_LABEL: Record<string, string> = {
  general: "General", cardiologia: "Cardiología", ecocardiograma: "Ecocardiograma", consulta_cardiologica: "Consulta cardiológica",
}
const REFERRAL_LOCATION_LABEL: Record<string, string> = {
  cimel: "CIMEL Lanús", swiss: "Swiss Medical Lomas", britanico: "Hospital Británico",
}

// GROWTH-01: embudo real visita → clic WhatsApp → lead → turno confirmado, por código de
// referencia (ver src/lib/landing-referral-codes.ts). Visitas/clicks agregados en SQL (RPC
// landing_referral_events, migración 20260712_growth_01_referral_attribution.sql) — leads es una
// tabla chica sin historial de problemas de escala, así que se agrega en JS sin RPC dedicada.
// El código de respaldo compartido "WEB-GRAL-01" (no atado a una sola landing) queda afuera de
// esta tabla a propósito: mostrar "0 visitas" sería engañoso para un link que no se trackea por slug.
async function getReferralFunnel(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: ReferralFunnelRow[]; available: boolean }> {
  try {
    const { data: events, error } = await supabase.rpc("landing_referral_events", { p_days: 90 })
    if (error) throw error

    const visitsBySlug = new Map<string, number>()
    const clicksBySlugLocation = new Map<string, number>()
    for (const row of (events ?? []) as { slug: string; location_key: string | null; event_type: string; event_count: number | string }[]) {
      const count = Number(row.event_count)
      if (row.event_type === "page_view") {
        visitsBySlug.set(row.slug, (visitsBySlug.get(row.slug) ?? 0) + count)
      } else if (row.event_type === "click_whatsapp" && row.location_key) {
        clicksBySlugLocation.set(`${row.slug}:${row.location_key}`, count)
      }
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: leadsData, error: leadsError } = await supabase
      .from("leads")
      .select("utm_content, confirmed_booked")
      .not("utm_content", "is", null)
      .gte("created_at", ninetyDaysAgo)
    if (leadsError) throw leadsError

    const leadsByCode = new Map<string, { total: number; confirmed: number }>()
    for (const lead of (leadsData ?? []) as { utm_content: string; confirmed_booked: boolean }[]) {
      const entry = leadsByCode.get(lead.utm_content) ?? { total: 0, confirmed: 0 }
      entry.total += 1
      if (lead.confirmed_booked) entry.confirmed += 1
      leadsByCode.set(lead.utm_content, entry)
    }

    const rows: ReferralFunnelRow[] = allReferralCodes()
      .filter(info => info.landingSlug !== "*")
      .map(info => {
        const leadsEntry = leadsByCode.get(info.code) ?? { total: 0, confirmed: 0 }
        return {
          code: info.code,
          landingSlug: info.landingSlug,
          locationLabel: info.locationKey ? REFERRAL_LOCATION_LABEL[info.locationKey] ?? info.locationKey : "—",
          specialty: REFERRAL_SPECIALTY_LABEL[info.specialty] ?? info.specialty,
          visits: visitsBySlug.get(info.landingSlug) ?? 0,
          whatsappClicks: info.locationKey ? clicksBySlugLocation.get(`${info.landingSlug}:${info.locationKey}`) ?? 0 : 0,
          leads: leadsEntry.total,
          confirmed: leadsEntry.confirmed,
        }
      })
      .sort((a, b) => b.leads - a.leads || b.visits - a.visits)

    return { rows, available: true }
  } catch {
    return { rows: [], available: false }
  }
}

// Sistema de recomendaciones de crecimiento (2026-07-07) — motor de reglas simples (sin ML) sobre
// datos que la app ya junta hoy en 4 canales (web/landings, WhatsApp, Instagram, Google Maps).
// La logica de cada regla vive en growth-recommendations.ts (testeada por separado); esta funcion
// solo hace el fetch minimo de cada canal y arma el input. Ver CLAUDE.md.
async function getGrowthRecommendationsData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  landingRanking: LandingRankingRow[],
  heroVariantRows: HeroVariantRow[]
): Promise<{ recommendations: GrowthRecommendation[]; available: boolean }> {
  try {
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
      supabase.from("app_config").select("value").eq("key", "instagram_access_token").maybeSingle(),
      supabase.from("app_config").select("value").eq("key", "google_refresh_token").maybeSingle(),
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
        connected: Boolean(instagramConn?.value),
        post: autoPublishSettings.post,
        historia: autoPublishSettings.historia,
      },
      google: {
        businessConnected: Boolean(googleConn?.value),
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

async function getDashboardData() {
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

  const conversionRate = totalLeads > 0
    ? Math.round((confirmed / totalLeads) * 100)
    : 0

  const landingRanking = await getLandingRanking(supabase)
  const heroVariantResults = await getHeroVariantResults(supabase)
  const referralFunnel = await getReferralFunnel(supabase)
  const clicksByLocation = await getClicksByLocation(supabase)
  const instagramFollowerTrend = await getInstagramFollowerTrend(supabase)
  const whatsappCostSummary = await getWhatsAppCostSummary(supabase)
  const growthRecommendations = await getGrowthRecommendationsData(supabase, landingRanking.rows, heroVariantResults.rows)
  const weeklyReports = await getWeeklyReports(supabase)

  // Total de visitas al sitio (últimos 90 días) para mostrar como KPI único -- antes solo se veía
  // desglosado por landing en "Ranking de landings", sin ningún número consolidado a simple vista.
  const totalVisits = landingRanking.available
    ? landingRanking.rows.reduce((sum, row) => sum + row.visits, 0)
    : null

  return {
    metrics, conversionRate, recentLeads: (recentLeads ?? []) as Lead[], totalVisits,
    landingRanking, heroVariantResults, referralFunnel, clicksByLocation, instagramFollowerTrend,
    whatsappCostSummary, growthRecommendations, weeklyReports,
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

export default async function DashboardPage() {
  const {
    metrics, conversionRate, recentLeads, totalVisits, landingRanking,
    heroVariantResults, referralFunnel, clicksByLocation, instagramFollowerTrend,
    whatsappCostSummary, growthRecommendations, weeklyReports,
  } = await getDashboardData()

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen de adquisición de pacientes</p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Eye className="h-4 w-4 text-indigo-500" /> Visitas al sitio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalVisits === null ? (
              <p className="text-sm text-gray-400">Sin datos</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">{totalVisits}</p>
                <p className="text-xs text-gray-400">Últimos 90 días, todas las landings</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Users className="h-4 w-4" /> Total leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-gray-900">{metrics.total}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Confirmaron turno
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{metrics.confirmed}</p>
            <p className="text-xs text-gray-400">{conversionRate}% conversión</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" /> Seguimiento pendiente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-orange-500">{metrics.followup_pending}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Requieren atención
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-500">{metrics.requires_human + metrics.emergencies}</p>
          </CardContent>
        </Card>
      </div>

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
            <CardTitle className="text-base">Leads por canal</CardTitle>
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

      {/* Ranking de landings */}
      {landingRanking.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ranking de landings</CardTitle>
            <p className="text-xs text-gray-500">
              Visitas e interacciones con los botones de pedir turno (últimos 90 días). La tasa de
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
              Últimos 90 días. Incluye Swiss Medical y Hospital Británico aunque ninguna de las dos
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

      {/* Embudo de atribución por código de referencia (GROWTH-01) */}
      {referralFunnel.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Embudo de atribución por landing/sede</CardTitle>
            <p className="text-xs text-gray-500">
              Visita → clic a WhatsApp → lead → turno confirmado, por código de referencia (últimos
              90 días). El código va al final del mensaje prellenado de cada CTA de WhatsApp — si el
              paciente lo borra antes de enviar, ese lead no queda atribuido a ninguna landing (no
              afecta la conversación, solo la atribución).
            </p>
          </CardHeader>
          <CardContent>
            {referralFunnel.rows.every(row => row.visits === 0 && row.leads === 0) ? (
              <p className="text-sm text-gray-400">
                Todavía no hay datos para este embudo. Se empieza a acumular desde que se agregó el
                código de referencia a los mensajes de WhatsApp (2026-07-12).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Código</th>
                      <th className="pb-2 font-medium">Landing</th>
                      <th className="pb-2 font-medium">Sede</th>
                      <th className="pb-2 font-medium text-right">Visitas</th>
                      <th className="pb-2 font-medium text-right">Clics WhatsApp</th>
                      <th className="pb-2 font-medium text-right">Leads</th>
                      <th className="pb-2 font-medium text-right">Turnos confirmados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralFunnel.rows.map(row => (
                      <tr key={row.code} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-2 font-mono text-xs text-gray-700">{row.code}</td>
                        <td className="py-2 pr-2 text-gray-900">
                          <Link href={`/${row.landingSlug}`} target="_blank" className="hover:underline">
                            {LANDING_DATA[row.landingSlug]?.h1 ?? row.landingSlug}
                          </Link>
                          <span className="block text-xs text-gray-400">{row.specialty}</span>
                        </td>
                        <td className="py-2 pr-2 text-gray-700">{row.locationLabel}</td>
                        <td className="py-2 text-right text-gray-700">{row.visits}</td>
                        <td className="py-2 text-right text-gray-700">{row.whatsappClicks}</td>
                        <td className="py-2 text-right text-gray-700">{row.leads}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{row.confirmed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              &quot;Ver sedes y horarios&quot;), asignada automáticamente 50/50 por cookie (últimos 90
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

      <SectionHeader icon={DollarSign} title="WhatsApp" />

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

      {/* Instagram: seguidores (snapshot diario, ver src/lib/instagram-followers.ts) */}
      {instagramFollowerTrend.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4" /> Instagram: seguidores
            </CardTitle>
          </CardHeader>
          <CardContent>
            {instagramFollowerTrend.trend === null ? (
              <p className="text-sm text-gray-400">
                Todavía no hay datos. Se registra un snapshot por día desde que se agregó este
                tracking (2026-07-13) — hace falta Instagram conectado y al menos una corrida del cron.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{instagramFollowerTrend.trend.current}</p>
                  <p className="text-xs text-gray-500 mt-1">Seguidores actuales</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${(instagramFollowerTrend.trend.deltaLast7Days ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {instagramFollowerTrend.trend.deltaLast7Days === null ? "—" : (
                      `${instagramFollowerTrend.trend.deltaLast7Days >= 0 ? "+" : ""}${instagramFollowerTrend.trend.deltaLast7Days}`
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Últimos 7 días</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${(instagramFollowerTrend.trend.deltaLast30Days ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {instagramFollowerTrend.trend.deltaLast30Days === null ? "—" : (
                      `${instagramFollowerTrend.trend.deltaLast30Days >= 0 ? "+" : ""}${instagramFollowerTrend.trend.deltaLast30Days}`
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Últimos 30 días</p>
                </div>
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
              Snapshot automático generado todos los lunes (leads nuevos, conversión y canales de la
              semana anterior). No se envía a ningún lado todavía — se guarda acá para consultar.
            </p>
          </CardHeader>
          <CardContent>
            {weeklyReports.rows.length === 0 ? (
              <p className="text-sm text-gray-400">
                Todavía no se generó ningún reporte semanal. El primero se genera el próximo lunes.
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
