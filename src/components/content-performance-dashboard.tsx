"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  metricsForLocation,
  perThousand,
  type ContentLocationKey,
  type ContentPerformanceRow,
  type ContentStrategyRecommendation,
} from "@/lib/content-performance"
import type { InstagramInsightWindow, InstagramMediaInsightSnapshot } from "@/types"

type PerformanceResponse = {
  rows: ContentPerformanceRow[]
  recommendations: ContentStrategyRecommendation[]
  since: string
  until: string
}

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
const LOCATION_LABELS: Record<Exclude<ContentLocationKey, "sin_atribuir">, string> = {
  cimel: "CIMEL Lanús",
  swiss: "Swiss Medical Lomas",
  britanico_lanus: "Hospital Británico Lanús",
  britanico_central: "Hospital Británico Central",
  britanico: "Hospital Británico — sede no identificada (registro anterior)",
}
const WINDOW_LABELS: Record<InstagramInsightWindow, string> = { "24h": "24 h", "72h": "72 h", "7d": "7 días" }

function nullableSum(
  rows: ContentPerformanceRow[],
  window: InstagramInsightWindow,
  field: keyof InstagramMediaInsightSnapshot,
): number | null {
  const values = rows.map(row => row.windows[window]?.[field]).filter((value): value is number => typeof value === "number")
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function metric(value: number | null | undefined): string {
  return value == null ? "No disponible" : new Intl.NumberFormat("es-AR").format(value)
}

function rate(value: number | null): string {
  return value == null ? "No disponible" : `${value.toLocaleString("es-AR")} / 1.000`
}

function downstreamTotal(row: ContentPerformanceRow, location: "all" | Exclude<ContentLocationKey, "sin_atribuir">) {
  return metricsForLocation(row, location)
}

export function ContentPerformanceDashboard() {
  const [days, setDays] = useState(90)
  const [data, setData] = useState<PerformanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [window, setWindow] = useState<InstagramInsightWindow>("7d")
  const [format, setFormat] = useState("all")
  const [weekday, setWeekday] = useState("all")
  const [hour, setHour] = useState("all")
  const [category, setCategory] = useState("all")
  const [objective, setObjective] = useState("all")
  const [location, setLocation] = useState<"all" | Exclude<ContentLocationKey, "sin_atribuir">>("all")
  const [itemId, setItemId] = useState("all")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`/api/content/performance?days=${days}`, { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "No se pudo cargar el rendimiento")
      setData(body as PerformanceResponse)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el rendimiento")
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const options = useMemo(() => {
    const rows = data?.rows ?? []
    return {
      formats: [...new Set(rows.map(row => row.format))].sort(),
      hours: [...new Set(rows.map(row => row.hour))].sort((a, b) => a - b),
      categories: [...new Set(rows.map(row => row.category))].sort(),
      objectives: [...new Set(rows.map(row => row.objective))].sort(),
    }
  }, [data])

  const filtered = useMemo(() => (data?.rows ?? []).filter(row => {
    if (format !== "all" && row.format !== format) return false
    if (weekday !== "all" && row.weekday !== Number(weekday)) return false
    if (hour !== "all" && row.hour !== Number(hour)) return false
    if (category !== "all" && row.category !== category) return false
    if (objective !== "all" && row.objective !== objective) return false
    if (itemId !== "all" && row.itemId !== itemId) return false
    if (location !== "all" && !row.attributionByLocation[location]) return false
    return true
  }), [category, data, format, hour, itemId, location, objective, weekday])

  const totals = useMemo(() => {
    const attribution = filtered.reduce((acc, row) => {
      const current = downstreamTotal(row, location)
      acc.visits += current.visits
      acc.clicks += current.clicks
      acc.whatsappClicks += current.whatsappClicks
      acc.conversations += current.conversations
      acc.leads += current.leads
      acc.confirmed += current.confirmed
      return acc
    }, { visits: 0, clicks: 0, whatsappClicks: 0, conversations: 0, leads: 0, confirmed: 0 })
    return {
      reach: nullableSum(filtered, window, "reach"),
      profileVisits: nullableSum(filtered, window, "profile_visits"),
      saved: nullableSum(filtered, window, "saved"),
      shares: nullableSum(filtered, window, "shares"),
      follows: nullableSum(filtered, window, "follows"),
      ...attribution,
    }
  }, [filtered, location, window])

  const slotComparisons = useMemo(() => {
    const grouped = new Map<string, ContentPerformanceRow[]>()
    for (const row of filtered) grouped.set(row.slotLabel, [...(grouped.get(row.slotLabel) ?? []), row])
    return [...grouped.entries()].map(([slot, rows]) => {
      const reach = nullableSum(rows, window, "reach")
      const saved = nullableSum(rows, window, "saved")
      const shares = nullableSum(rows, window, "shares")
      const attribution = rows.reduce((acc, row) => {
        const current = downstreamTotal(row, location)
        acc.conversations += current.conversations
        acc.leads += current.leads
        acc.confirmed += current.confirmed
        return acc
      }, { conversations: 0, leads: 0, confirmed: 0 })
      return { slot, pieces: rows.length, reach, savedRate: perThousand(saved, reach), sharesRate: perThousand(shares, reach), ...attribution }
    }).sort((left, right) => right.pieces - left.pieces || left.slot.localeCompare(right.slot))
  }, [filtered, location, window])

  async function review(recommendation: ContentStrategyRecommendation, status: "approved" | "dismissed") {
    setReviewing(recommendation.key)
    setError("")
    try {
      const response = await fetch("/api/content/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, recommendationKey: recommendation.key, status }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "No se pudo guardar la decisión")
      setData(current => current ? {
        ...current,
        recommendations: current.recommendations.map(item => item.key === recommendation.key ? { ...item, status } : item),
      } : current)
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No se pudo guardar la decisión")
    } finally {
      setReviewing(null)
    }
  }

  if (loading && !data) {
    return <div className="flex min-h-64 items-center justify-center text-sm text-gray-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cargando rendimiento…</div>
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><BarChart3 className="h-5 w-5 text-pink-700" />Rendimiento y atribución</CardTitle>
          <p className="text-sm text-gray-500">Separa alcance, clic, conversación, lead y turno confirmado. Un clic nunca se cuenta como conversión.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
            <Filter label="Período" value={String(days)} onChange={value => setDays(Number(value))} options={[["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["180", "180 días"], ["365", "1 año"]]} />
            <Filter label="Formato" value={format} onChange={setFormat} options={[["all", "Todos"], ...options.formats.map(value => [value, value])]} />
            <Filter label="Día" value={weekday} onChange={setWeekday} options={[["all", "Todos"], ...DAY_LABELS.map((label, index) => [String(index), label])]} />
            <Filter label="Franja" value={hour} onChange={setHour} options={[["all", "Todas"], ...options.hours.map(value => [String(value), `${value}:00–${(value + 1) % 24}:00`])]} />
            <Filter label="Categoría" value={category} onChange={setCategory} options={[["all", "Todas"], ...options.categories.map(value => [value, value])]} />
            <Filter label="Objetivo" value={objective} onChange={setObjective} options={[["all", "Todos"], ...options.objectives.map(value => [value, value])]} />
            <Filter label="Sede" value={location} onChange={value => setLocation(value as typeof location)} options={[["all", "Todas"], ...Object.entries(LOCATION_LABELS)]} />
            <Filter label="Pieza" value={itemId} onChange={setItemId} options={[["all", "Todas"], ...(data?.rows ?? []).map(row => [row.itemId, row.topic])]} />
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(WINDOW_LABELS) as InstagramInsightWindow[]).map(value => (
              <Button key={value} type="button" size="sm" variant={window === value ? "default" : "outline"} onClick={() => setWindow(value)}>{WINDOW_LABELS[value]}</Button>
            ))}
            <span className="self-center text-xs text-gray-500">Métricas de Meta al snapshot comparable; atribución dentro del período elegido.</span>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <MetricCard label="Alcance" value={metric(totals.reach)} />
            <MetricCard label="Visitas al perfil" value={metric(totals.profileVisits)} />
            <MetricCard label="Clics" value={metric(totals.clicks)} />
            <MetricCard label="Conversaciones" value={metric(totals.conversations)} />
            <MetricCard label="Leads" value={metric(totals.leads)} />
            <MetricCard label="Turnos confirmados" value={metric(totals.confirmed)} />
            <MetricCard label="Seguidores / 1.000" value={rate(perThousand(totals.follows, totals.reach))} />
            <MetricCard label="Guardados / 1.000" value={rate(perThousand(totals.saved, totals.reach))} />
            <MetricCard label="Compartidos / 1.000" value={rate(perThousand(totals.shares, totals.reach))} />
            <MetricCard label="Visitas landing" value={metric(totals.visits)} />
            <MetricCard label="Clics a WhatsApp" value={metric(totals.whatsappClicks)} />
            <MetricCard label="% no seguidores" value="No disponible" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Comparación por día y franja</CardTitle></CardHeader>
        <CardContent>
          {slotComparisons.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm [&_th]:whitespace-nowrap [&_th]:pr-4 [&_td]:pr-4">
                <thead className="border-b text-xs uppercase text-gray-500"><tr><th className="py-2">Franja</th><th>Piezas</th><th>Alcance</th><th>Guardados / 1.000</th><th>Compartidos / 1.000</th><th>Conversaciones</th><th>Leads</th><th>Turnos</th></tr></thead>
                <tbody>{slotComparisons.map(row => <tr key={row.slot} className="border-b last:border-0"><td className="py-3 font-medium">{row.slot}</td><td>{row.pieces}</td><td>{metric(row.reach)}</td><td>{rate(row.savedRate)}</td><td>{rate(row.sharesRate)}</td><td>{row.conversations}</td><td>{row.leads}</td><td>{row.confirmed}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Piezas comparables</CardTitle></CardHeader>
        <CardContent>
          {filtered.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm [&_th]:whitespace-nowrap [&_th]:pr-4 [&_td]:pr-4">
                <thead className="border-b text-xs uppercase text-gray-500"><tr><th className="py-2">Pieza</th><th>Formato</th><th>Franja</th><th>Alcance</th><th>Guardados</th><th>Compartidos</th><th>Perfil</th><th>Clics</th><th>Conversaciones</th><th>Leads</th><th>Turnos</th></tr></thead>
                <tbody>{filtered.map(row => {
                  const snapshot = row.windows[window]
                  const attribution = downstreamTotal(row, location)
                  return <tr key={row.itemId} className="border-b last:border-0"><td className="max-w-60 py-3 font-medium">{row.topic}</td><td>{row.format}</td><td>{row.slotLabel}</td><td>{metric(snapshot?.reach)}</td><td>{metric(snapshot?.saved)}</td><td>{metric(snapshot?.shares)}</td><td>{metric(snapshot?.profile_visits)}</td><td>{attribution.clicks}</td><td>{attribution.conversations}</td><td>{attribution.leads}</td><td>{attribution.confirmed}</td></tr>
                })}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recomendaciones estratégicas</CardTitle>
          <p className="text-sm text-gray-500">Sólo compara el mismo formato y objetivo, con al menos 3 piezas por franja. Aprobar registra la decisión; nunca cambia el cronograma automáticamente.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.recommendations ?? []).length === 0 ? (
            <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">Todavía no hay datos suficientes para recomendar un cambio.</p>
          ) : data?.recommendations.map(recommendation => (
            <div key={recommendation.key} className="rounded-xl border p-4">
              <p className="text-sm leading-relaxed">{recommendation.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {recommendation.status === "approved" && <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700"><Check className="h-4 w-4" />Aprobada</span>}
                {recommendation.status === "dismissed" && <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-500"><X className="h-4 w-4" />Descartada</span>}
                {recommendation.status === "pending" && <>
                  <Button size="sm" onClick={() => void review(recommendation, "approved")} disabled={reviewing === recommendation.key}>{reviewing === recommendation.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprobar recomendación</Button>
                  <Button size="sm" variant="outline" onClick={() => void review(recommendation, "dismissed")} disabled={reviewing === recommendation.key}>Descartar</Button>
                </>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <label className="space-y-1 text-xs font-medium text-gray-600"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)} className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900"><>{options.map(([optionValue, optionLabel]) => <option key={`${label}-${optionValue}`} value={optionValue}>{optionLabel}</option>)}</></select></label>
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-gray-50 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold text-gray-900">{value}</p></div>
}

function Empty() {
  return <p className="py-6 text-center text-sm text-gray-500">No hay piezas con datos para estos filtros.</p>
}
