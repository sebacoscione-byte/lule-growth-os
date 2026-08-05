"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Info,
  Landmark,
  Loader2,
  Plus,
  Save,
  Stethoscope,
  Trash2,
  WalletCards,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ACTIVITY_META,
  WEEK_DAYS,
  buildMonthlyProjections,
  buildScheduleBlocks,
  buildScheduleSlots,
  planningConfigSchema,
  summarizeInstitutions,
  type ActivityKey,
  type PlanningConfig,
  type ScheduleInterval,
  type WeekDayKey,
} from "@/lib/practice-planning"

const ACTIVITY_CLASSES: Record<ActivityKey, string> = {
  INVESTIGACION: "border-blue-200 bg-blue-50 text-blue-800",
  ALMUERZO: "border-orange-200 bg-orange-50 text-orange-800",
  "CONSULTORIO CIMEL": "border-emerald-200 bg-emerald-50 text-emerald-800",
  "ECOCARDIOGRAMA HB LANUS": "border-yellow-200 bg-yellow-50 text-yellow-900",
  "CONSULTORIO HB CENTRAL": "border-amber-200 bg-amber-50 text-amber-900",
  "CONSULTORIO SMG": "border-violet-200 bg-violet-50 text-violet-800",
  CERAMICA: "border-stone-200 bg-stone-100 text-stone-700",
  LIBRE: "border-gray-200 bg-white text-gray-400",
}

const ACTIVITY_DOTS: Record<ActivityKey, string> = {
  INVESTIGACION: "bg-blue-500",
  ALMUERZO: "bg-orange-500",
  "CONSULTORIO CIMEL": "bg-emerald-500",
  "ECOCARDIOGRAMA HB LANUS": "bg-yellow-500",
  "CONSULTORIO HB CENTRAL": "bg-amber-500",
  "CONSULTORIO SMG": "bg-violet-500",
  CERAMICA: "bg-stone-400",
  LIBRE: "bg-gray-300",
}

const INSTITUTION_BAR_CLASSES = {
  cimel: "bg-emerald-500",
  "hb-lanus": "bg-yellow-500",
  "hb-central": "bg-amber-500",
  swiss: "bg-violet-500",
  research: "bg-blue-500",
} as const

function money(value: number) {
  return `$ ${Math.round(value).toLocaleString("es-AR")}`
}

function hours(value: number) {
  return `${value.toLocaleString("es-AR", { minimumFractionDigits: 2 })} h`
}

function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number)
  return hour * 60 + minute
}

function timeFromMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
}

function nextFreeInterval(day: WeekDayKey, intervals: ScheduleInterval[]): ScheduleInterval {
  const dayIntervals = intervals.filter(interval => interval.day === day)
  for (let start = minutes("09:00"); start <= minutes("20:15"); start += 15) {
    const end = Math.min(start + 60, minutes("20:30"))
    const overlaps = dayIntervals.some(interval =>
      minutes(interval.start) < end && minutes(interval.end) > start
    )
    if (!overlaps) {
      return {
        day,
        start: timeFromMinutes(start),
        end: timeFromMinutes(end),
        activity: "CONSULTORIO CIMEL",
      }
    }
  }
  return { day, start: "20:15", end: "20:30", activity: "CONSULTORIO CIMEL" }
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Clock3
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
            <p className="mt-1 whitespace-nowrap text-lg font-bold tracking-tight text-gray-950 sm:text-xl md:text-2xl">{value}</p>
            <p className="mt-1 text-xs text-gray-500">{detail}</p>
          </div>
          <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700">
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function PlanningPage() {
  const [config, setConfig] = useState<PlanningConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [newHoliday, setNewHoliday] = useState("")

  const loadPlanning = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/planning", { cache: "no-store" })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar la planificación")
      const parsed = planningConfigSchema.safeParse(body.config)
      if (!parsed.success) throw new Error("La planificación guardada no es válida")
      setConfig(parsed.data)
      setUpdatedAt(body.updated_at ?? null)
      setDirty(false)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la planificación")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPlanning()
  }, [loadPlanning])

  function updateConfig(updater: (current: PlanningConfig) => PlanningConfig) {
    setConfig(current => current ? updater(current) : current)
    setDirty(true)
    setSavedMessage(null)
    setError(null)
  }

  function updateInterval(index: number, patch: Partial<ScheduleInterval>) {
    updateConfig(current => ({
      ...current,
      intervals: current.intervals.map((interval, intervalIndex) =>
        intervalIndex === index ? { ...interval, ...patch } : interval
      ),
    }))
  }

  function removeInterval(index: number) {
    updateConfig(current => ({
      ...current,
      intervals: current.intervals.filter((_, intervalIndex) => intervalIndex !== index),
    }))
  }

  function addInterval(day: WeekDayKey) {
    updateConfig(current => ({
      ...current,
      intervals: [...current.intervals, nextFreeInterval(day, current.intervals)],
    }))
  }

  async function savePlanning() {
    if (!config) return
    const parsed = planningConfigSchema.safeParse(config)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisá los datos ingresados")
      return
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      const response = await fetch("/api/planning", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar la planificación")
      setConfig(body.config)
      setUpdatedAt(body.updated_at ?? null)
      setDirty(false)
      setSavedMessage("Cambios guardados")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la planificación")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></div>
  }

  if (!config) {
    return (
      <div className="p-4 md:p-6">
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <div><p className="font-semibold text-gray-900">No pudimos cargar la planificación</p><p className="mt-1 text-sm text-gray-500">{error}</p></div>
            <Button onClick={() => void loadPlanning()} variant="outline">Reintentar</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const slots = buildScheduleSlots(config.intervals)
  const blocks = buildScheduleBlocks(slots)
  const summaries = summarizeInstitutions(slots, config.rules)
  const projections = buildMonthlyProjections(config)
  const activeActivities = (Object.keys(ACTIVITY_META) as ActivityKey[]).filter(
    activity => activity !== "LIBRE"
  )
  const totalHours = summaries.reduce((total, row) => total + row.hoursPerWeek, 0)
  const totalServices = summaries.reduce((total, row) => total + row.servicesPerWeek, 0)
  const weeklyIncome = summaries.reduce((total, row) => total + row.weeklyIncome, 0)
  const averageMonthlyIncome = summaries.reduce(
    (total, row) => total + row.averageMonthlyIncome,
    0
  )

  return (
    <div className="space-y-5 p-4 md:space-y-6 md:p-6">
      <header className="overflow-hidden rounded-2xl border border-emerald-900/10 bg-[linear-gradient(120deg,#123c36_0%,#176156_64%,#277d6e_100%)] px-5 py-6 text-white shadow-sm md:px-7 md:py-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-emerald-100">
              <CalendarDays className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                Planificación profesional
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Agenda e ingresos</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-50/90">
              Gestioná horarios, aranceles, feriados y proyecciones en un solo lugar. Los ingresos
              se recalculan automáticamente con cada cambio.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <Button
              onClick={() => void savePlanning()}
              disabled={!dirty || saving}
              className="min-w-40 gap-2 bg-white text-emerald-900 hover:bg-emerald-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Guardando..." : dirty ? "Guardar cambios" : "Todo guardado"}
            </Button>
            <p className="text-xs text-emerald-100">
              {savedMessage ?? (updatedAt ? `Última actualización: ${new Date(updatedAt).toLocaleString("es-AR")}` : "Configuración persistente")}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {savedMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {savedMessage}
        </div>
      )}

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          icon={Clock3}
          label="Carga semanal"
          value={hours(totalHours)}
          detail="actividad profesional remunerable y de investigación"
        />
        <MetricCard
          icon={Stethoscope}
          label="Prestaciones"
          value={String(totalServices)}
          detail="consultas y ecocardiogramas por semana"
        />
        <MetricCard
          icon={WalletCards}
          label="Ingreso semanal"
          value={money(weeklyIncome)}
          detail="agenda completa y sin cancelaciones"
        />
        <MetricCard
          icon={BarChart3}
          label="Promedio mensual"
          value={money(averageMonthlyIncome)}
          detail={`${config.rules.averageWeeksPerMonth.toLocaleString("es-AR")} semanas promedio`}
        />
      </section>

      <Tabs defaultValue="agenda">
        <TabsList className="h-auto w-full justify-start md:w-auto">
          <TabsTrigger value="agenda" className="gap-2" aria-label="Agenda semanal">
            <CalendarDays className="hidden h-4 w-4 sm:block" />
            <span aria-hidden="true"><span className="sm:hidden">Agenda</span><span className="hidden sm:inline">Agenda semanal</span></span>
          </TabsTrigger>
          <TabsTrigger value="ingresos" className="gap-2" aria-label="Por institución">
            <Landmark className="hidden h-4 w-4 sm:block" />
            <span aria-hidden="true"><span className="sm:hidden">Ingresos</span><span className="hidden sm:inline">Por institución</span></span>
          </TabsTrigger>
          <TabsTrigger value="proyeccion" className="gap-2" aria-label="Proyección mensual">
            <BarChart3 className="hidden h-4 w-4 sm:block" />
            <span aria-hidden="true"><span className="sm:hidden">Proyección</span><span className="hidden sm:inline">Proyección mensual</span></span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="p-4 pb-3 md:p-6 md:pb-4">
              <CardTitle className="text-base">Editar bloques semanales</CardTitle>
              <p className="text-sm text-gray-500">
                Agregá, modificá o eliminá bloques. Los horarios deben usar intervalos de 15 minutos
                y no pueden superponerse dentro del mismo día.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {WEEK_DAYS.map(day => {
                  const dayIntervals = config.intervals
                    .map((interval, index) => ({ interval, index }))
                    .filter(item => item.interval.day === day.key)
                    .sort((left, right) => left.interval.start.localeCompare(right.interval.start))
                  return (
                    <section key={day.key} className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-gray-900">{day.label}</h2>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addInterval(day.key)}
                          className="h-8 gap-1 px-2 text-xs"
                        >
                          <Plus className="h-3.5 w-3.5" /> Bloque
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {dayIntervals.length === 0 && (
                          <p className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-5 text-center text-xs text-gray-400">
                            Sin actividad
                          </p>
                        )}
                        {dayIntervals.map(({ interval, index }) => (
                          <div key={`${index}-${interval.start}`} className="rounded-lg border border-gray-200 bg-white p-2.5">
                            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                Inicio
                                <Input
                                  type="time"
                                  step={900}
                                  value={interval.start}
                                  onChange={event => updateInterval(index, { start: event.target.value })}
                                  className="mt-1 h-9 px-2 text-xs"
                                />
                              </label>
                              <label className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                                Fin
                                <Input
                                  type="time"
                                  step={900}
                                  value={interval.end}
                                  onChange={event => updateInterval(index, { end: event.target.value })}
                                  className="mt-1 h-9 px-2 text-xs"
                                />
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeInterval(index)}
                                className="mt-4 h-9 w-9 p-0 text-gray-400 hover:text-red-600"
                                aria-label={`Eliminar bloque de ${day.label} a las ${interval.start}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-gray-400">
                              Actividad
                              <select
                                value={interval.activity}
                                onChange={event => updateInterval(index, { activity: event.target.value as Exclude<ActivityKey, "LIBRE"> })}
                                className="mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                              >
                                {activeActivities.map(activity => (
                                  <option key={activity} value={activity}>{ACTIVITY_META[activity].label}</option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 p-4 pb-3 md:p-6 md:pb-4">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                <div>
                  <CardTitle className="text-base">Semana habitual</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">
                    Los bloques continuos se agrupan para lectura rápida. El detalle conserva las
                    46 franjas de 15 minutos.
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {activeActivities.map(activity => (
                    <span key={activity} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      <span className={`h-2 w-2 rounded-full ${ACTIVITY_DOTS[activity]}`} />
                      {ACTIVITY_META[activity].shortLabel}
                    </span>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
                {WEEK_DAYS.map(day => {
                  const dayBlocks = blocks.filter(block => block.day === day.key)
                  return (
                    <article key={day.key} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-gray-900">{day.label}</h2>
                        <span className="text-[11px] text-gray-400">
                          {dayBlocks.length
                            ? `${dayBlocks.filter(block => block.activity !== "LIBRE").reduce((sum, block) => sum + block.hours, 0).toLocaleString("es-AR")} h ocupadas`
                            : "Sin bloques"}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {dayBlocks.length ? (
                          dayBlocks.map(block => (
                            <div
                              key={`${block.start}-${block.activity}`}
                              className={`rounded-lg border px-2.5 py-2 ${ACTIVITY_CLASSES[block.activity]}`}
                            >
                              <p className="text-[11px] font-semibold tabular-nums">
                                {block.start}–{block.end}
                              </p>
                              <p className="mt-0.5 text-xs font-medium leading-tight">
                                {ACTIVITY_META[block.activity].shortLabel}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-8 text-center text-xs text-gray-400">
                            Sin actividad cargada
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <details>
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-gray-900 marker:hidden md:px-6">
                Detalle en franjas de 15 minutos
                <Badge variant="outline">09:00–20:30</Badge>
              </summary>
              <div className="border-t border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-gray-900 text-white">
                      <tr>
                        <th className="w-28 px-3 py-2.5 text-left font-semibold">Horario</th>
                        {WEEK_DAYS.map(day => (
                          <th key={day.key} className="px-2 py-2.5 text-left font-semibold">
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map(slot => (
                        <tr key={slot.start} className="border-b border-gray-100 last:border-0">
                          <td className="whitespace-nowrap bg-gray-50 px-3 py-1.5 font-semibold tabular-nums text-gray-600">
                            {slot.start}–{slot.end}
                          </td>
                          {WEEK_DAYS.map(day => {
                            const activity = slot.activities[day.key]
                            return (
                              <td key={day.key} className="p-1">
                                {activity ? (
                                  <span className={`block rounded border px-1.5 py-1 text-[10px] font-medium ${ACTIVITY_CLASSES[activity]}`}>
                                    {ACTIVITY_META[activity].shortLabel}
                                  </span>
                                ) : (
                                  <span className="block px-1.5 py-1 text-gray-300">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          </Card>
        </TabsContent>

        <TabsContent value="ingresos" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="p-4 pb-3 md:p-6 md:pb-4">
              <CardTitle className="text-base">Ingresos mensuales por institución</CardTitle>
              <p className="text-sm text-gray-500">
                En consultorio y ecocardiografía, cada franja de 15 minutos equivale a una
                prestación. Los particulares se asignan al primer consultorio de cada día.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-5 py-3 font-medium">Institución</th>
                      <th className="px-3 py-3 font-medium">Actividad</th>
                      <th className="px-3 py-3 text-right font-medium">Bloques</th>
                      <th className="px-3 py-3 text-right font-medium">Horas</th>
                      <th className="px-3 py-3 text-right font-medium">Prestaciones</th>
                      <th className="px-3 py-3 text-right font-medium">Particulares</th>
                      <th className="px-3 py-3 text-right font-medium">Prepaga / OS</th>
                      <th className="px-3 py-3 text-right font-medium">Semanal</th>
                      <th className="px-5 py-3 text-right font-medium">Mensual prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map(row => (
                      <tr key={row.key} className="border-b border-gray-100 last:border-0">
                        <td className="px-5 py-3.5 font-semibold text-gray-900">{row.name}</td>
                        <td className="px-3 py-3.5 text-gray-600">{row.activity}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">{row.slotsPerWeek}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">{hours(row.hoursPerWeek)}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">{row.servicesPerWeek}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">{row.privatePerWeek}</td>
                        <td className="px-3 py-3.5 text-right tabular-nums text-gray-700">{row.coveredPerWeek}</td>
                        <td className="px-3 py-3.5 text-right font-medium tabular-nums text-gray-900">{money(row.weeklyIncome)}</td>
                        <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-gray-950">{money(row.averageMonthlyIncome)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950">
                      <td className="px-5 py-3.5" colSpan={2}>TOTAL</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{summaries.reduce((sum, row) => sum + row.slotsPerWeek, 0)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{hours(totalHours)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{totalServices}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{summaries.reduce((sum, row) => sum + row.privatePerWeek, 0)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{summaries.reduce((sum, row) => sum + row.coveredPerWeek, 0)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{money(weeklyIncome)}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{money(averageMonthlyIncome)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-3 md:p-6 md:pb-4">
              <CardTitle className="text-base">Editar aranceles y reglas</CardTitle>
              <p className="text-sm text-gray-500">Los totales se recalculan mientras escribís. Guardá para conservar los cambios.</p>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-4 md:p-6 md:pt-0">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">Unidad de agenda</p>
                <p className="mt-1 text-base font-semibold text-gray-900">15 minutos</p>
                <p className="mt-1 text-[11px] text-gray-400">Cada bloque asistencial equivale a una prestación.</p>
              </div>
              {([
                { key: "privateConsultationValue", label: "Valor particular", step: 1000, currency: true },
                { key: "coveredConsultationValue", label: "Valor prepaga / OS", step: 1000, currency: true },
                { key: "echocardiogramValue", label: "Valor ecocardiograma", step: 1000, currency: true },
                { key: "monthlyResearchValue", label: "Investigación mensual", step: 1000, currency: true },
                { key: "privatePatientsPerDay", label: "Particulares por día", step: 1, currency: false },
                { key: "averageWeeksPerMonth", label: "Semanas promedio por mes", step: 0.01, currency: false },
              ] as const).map(field => (
                <label key={field.key} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                  {field.label}
                  <Input
                    type="number"
                    min={0}
                    step={field.step}
                    value={config.rules[field.key]}
                    onChange={event => updateConfig(current => ({
                      ...current,
                      rules: { ...current.rules, [field.key]: Number(event.target.value) },
                    }))}
                    className="mt-2 bg-white text-base font-semibold text-gray-900"
                  />
                  {field.currency && <span className="mt-1 block text-[11px] text-gray-400">{money(config.rules[field.key])}</span>}
                </label>
              ))}
              {dirty && (
                <div className="flex items-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Hay cambios sin guardar.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proyeccion" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="p-4 pb-3 md:p-6 md:pb-4">
              <CardTitle className="text-base">Configurar período y feriados</CardTitle>
              <p className="text-sm text-gray-500">Los días cargados se excluyen de la proyección si coinciden con una jornada de atención.</p>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0 md:p-6 md:pt-0">
              <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
                <label className="text-xs font-medium text-gray-600">
                  Mes inicial
                  <Input
                    type="month"
                    value={config.projectionStartMonth}
                    onChange={event => updateConfig(current => ({ ...current, projectionStartMonth: event.target.value }))}
                    className="mt-1.5 bg-white"
                  />
                </label>
                <label className="text-xs font-medium text-gray-600">
                  Meses a proyectar
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={config.projectionMonths}
                    onChange={event => updateConfig(current => ({ ...current, projectionMonths: Number(event.target.value) }))}
                    className="mt-1.5 bg-white"
                  />
                </label>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600">Feriados y días sin atención</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input type="date" value={newHoliday} onChange={event => setNewHoliday(event.target.value)} className="sm:max-w-56" />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!newHoliday || config.holidays.includes(newHoliday)}
                    onClick={() => {
                      if (!newHoliday || config.holidays.includes(newHoliday)) return
                      updateConfig(current => ({ ...current, holidays: [...current.holidays, newHoliday].sort() }))
                      setNewHoliday("")
                    }}
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" /> Agregar fecha
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {config.holidays.length === 0 && <p className="text-xs text-gray-400">No hay fechas excluidas.</p>}
                  {config.holidays.map(holiday => (
                    <span key={holiday} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1 text-xs text-gray-700">
                      {new Date(`${holiday}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
                      <button
                        type="button"
                        onClick={() => updateConfig(current => ({ ...current, holidays: current.holidays.filter(date => date !== holiday) }))}
                        className="rounded-full p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Eliminar fecha ${holiday}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-3 md:p-6 md:pb-4">
              <CardTitle className="text-base capitalize">
                Proyección calendario · {projections[0]?.label}–{projections.at(-1)?.label}
              </CardTitle>
              <p className="text-sm text-gray-500">
                Usa los días reales de atención y excluye las fechas configuradas arriba.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-5 py-3 font-medium">Concepto</th>
                      {projections.map(month => (
                        <th key={month.label} className="px-4 py-3 text-right font-medium capitalize">{month.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100">
                      <td className="px-5 py-3 text-gray-600">Días hábiles</td>
                      {projections.map(month => <td key={month.label} className="px-4 py-3 text-right tabular-nums">{month.businessDays}</td>)}
                    </tr>
                    {([
                      ["Martes de atención", "tuesday"],
                      ["Miércoles de atención", "wednesday"],
                      ["Jueves de atención", "thursday"],
                      ["Viernes de atención", "friday"],
                    ] as const).map(([label, key]) => (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="px-5 py-3 text-gray-600">{label}</td>
                        {projections.map(month => <td key={month.label} className="px-4 py-3 text-right tabular-nums">{month.attentionDays[key]}</td>)}
                      </tr>
                    ))}
                    {summaries.map(row => (
                      <tr key={row.key} className="border-b border-gray-100">
                        <td className="px-5 py-3 font-medium text-gray-900">{row.key === "hb-lanus" ? "HB Lanús · Ecocardiogramas" : row.name}</td>
                        {projections.map(month => (
                          <td key={month.label} className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                            {money(month.institutions[row.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-emerald-200 bg-emerald-50/70 font-semibold text-emerald-950">
                      <td className="px-5 py-4">TOTAL MENSUAL</td>
                      {projections.map(month => <td key={month.label} className="px-4 py-4 text-right text-base tabular-nums">{money(month.total)}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {projections.map(month => (
              <Card key={month.label}>
                <CardContent className="p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium capitalize text-gray-500">{month.label}</p>
                      <p className="mt-1 text-xl font-bold text-gray-950">{money(month.total)}</p>
                    </div>
                    <Badge variant="outline">{month.businessDays} hábiles</Badge>
                  </div>
                  <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-gray-100" aria-label={`Composición de ingresos de ${month.label}`}>
                    {summaries.map(row => (
                      <span
                        key={row.key}
                        className={INSTITUTION_BAR_CLASSES[row.key]}
                        style={{ width: `${month.total ? (month.institutions[row.key] / month.total) * 100 : 0}%` }}
                        title={`${row.name}: ${money(month.institutions[row.key])}`}
                      />
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-gray-500">
                    {summaries.filter(row => month.institutions[row.key] > 0).map(row => (
                      <span key={row.key} className="flex min-w-0 items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${INSTITUTION_BAR_CLASSES[row.key]}`} />
                        <span className="truncate">{row.name}</span>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <aside className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta sección es una proyección operativa: supone agenda completa y sin cancelaciones. No
          agenda turnos ni representa cobros reales. Los cambios se guardan en la app y se aplican
          a todos los cálculos de esta sección.
        </p>
      </aside>
    </div>
  )
}
