import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, CheckCircle2, AlertTriangle, Clock,
  MapPin, Camera, Search, MessageSquare
} from "lucide-react"
import { STATUS_LABELS, STATUS_COLORS, type Lead } from "@/types"
import { timeAgo } from "@/lib/utils"
import { LANDING_DATA, PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"
import Link from "next/link"

const INTERACTION_EVENT_TYPES = ["click_booking", "click_call", "click_whatsapp", "click_maps"]

type LandingRankingRow = {
  slug: string
  label: string
  visits: number
  interactions: number
  rate: number
}

async function getLandingRanking(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: LandingRankingRow[]; available: boolean }> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from("landing_events")
      .select("slug, event_type")
      .in("event_type", ["page_view", ...INTERACTION_EVENT_TYPES])
      .gte("created_at", ninetyDaysAgo)
      .limit(20000)
    if (error) throw error

    const bySlug = new Map<string, { visits: number; interactions: number }>()
    for (const row of data ?? []) {
      const entry = bySlug.get(row.slug) ?? { visits: 0, interactions: 0 }
      if (row.event_type === "page_view") entry.visits += 1
      else entry.interactions += 1
      bySlug.set(row.slug, entry)
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

const HERO_VARIANT_EVENT_TYPES = ["page_view", "click_hero_primary", "click_hero_secondary", ...INTERACTION_EVENT_TYPES]

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
async function getHeroVariantResults(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ rows: HeroVariantRow[]; available: boolean }> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from("landing_events")
      .select("event_type, variant")
      .eq("slug", "dra-lucia-chahin")
      .in("variant", ["a", "b"])
      .in("event_type", HERO_VARIANT_EVENT_TYPES)
      .gte("created_at", ninetyDaysAgo)
      .limit(20000)
    if (error) throw error

    const byVariant = new Map<"a" | "b", { visits: number; heroPrimaryClicks: number; heroSecondaryClicks: number; interactions: number }>()
    for (const row of data ?? []) {
      const variant = row.variant as "a" | "b"
      const entry = byVariant.get(variant) ?? { visits: 0, heroPrimaryClicks: 0, heroSecondaryClicks: 0, interactions: 0 }
      if (row.event_type === "page_view") entry.visits += 1
      else if (row.event_type === "click_hero_primary") entry.heroPrimaryClicks += 1
      else if (row.event_type === "click_hero_secondary") entry.heroSecondaryClicks += 1
      else entry.interactions += 1
      byVariant.set(variant, entry)
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

  // Landing events (tabla puede no existir todavía — no bloquea el dashboard)
  const landingMetrics = await (async () => {
    try {
      const [
        { count: cimel },
        { count: swiss },
        { count: britanico },
        { count: forms },
      ] = await Promise.all([
        supabase.from("landing_events").select("id", { count: "exact", head: true }).eq("event_type", "cta_cimel"),
        supabase.from("landing_events").select("id", { count: "exact", head: true }).eq("event_type", "cta_swiss"),
        supabase.from("landing_events").select("id", { count: "exact", head: true }).eq("event_type", "cta_britanico"),
        supabase.from("landing_events").select("id", { count: "exact", head: true }).eq("event_type", "form_submitted"),
      ])
      return { cimel: cimel ?? 0, swiss: swiss ?? 0, britanico: britanico ?? 0, forms: forms ?? 0, available: true }
    } catch {
      return { cimel: 0, swiss: 0, britanico: 0, forms: 0, available: false }
    }
  })()

  const landingRanking = await getLandingRanking(supabase)
  const heroVariantResults = await getHeroVariantResults(supabase)
  const weeklyReports = await getWeeklyReports(supabase)

  return { metrics, conversionRate, recentLeads: (recentLeads ?? []) as Lead[], landingMetrics, landingRanking, heroVariantResults, weeklyReports }
}

export default async function DashboardPage() {
  const { metrics, conversionRate, recentLeads, landingMetrics, landingRanking, heroVariantResults, weeklyReports } = await getDashboardData()

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen de adquisición de pacientes</p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-4">
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

      {/* Métricas de landings */}
      {landingMetrics.available && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métricas de landings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
              <div>
                <p className="text-2xl font-bold text-blue-600">{landingMetrics.cimel}</p>
                <p className="text-xs text-gray-500 mt-1">Instrucciones CIMEL vistas</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-sky-600">{landingMetrics.britanico}</p>
                <p className="text-xs text-gray-500 mt-1">Instrucciones Británico vistas</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-teal-600">{landingMetrics.swiss}</p>
                <p className="text-xs text-gray-500 mt-1">Instrucciones Swiss vistas</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{landingMetrics.forms}</p>
                <p className="text-xs text-gray-500 mt-1">Formularios enviados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
          </CardHeader>
          <CardContent>
            {heroVariantResults.rows.every(row => row.visits === 0) ? (
              <p className="text-sm text-gray-400">Todavía no hay visitas con variante asignada.</p>
            ) : (
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
            )}
          </CardContent>
        </Card>
      )}

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
