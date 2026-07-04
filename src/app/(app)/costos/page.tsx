import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DollarSign, MessageSquare, AlertTriangle, Users, TrendingUp, HelpCircle } from "lucide-react"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"

interface CostEventRow {
  direction: "inbound" | "outbound"
  cost_estimated: number | null
  currency: string | null
  created_at: string
  flow_intent: string | null
  lead_id: string | null
  wa_id: string
}

function sumCosts(rows: CostEventRow[]): { total: number; pending: number } {
  let total = 0
  let pending = 0
  for (const row of rows) {
    if (row.cost_estimated === null) pending += 1
    else total += row.cost_estimated
  }
  return { total, pending }
}

async function getCostsData() {
  const supabase = await createClient()
  const now = Date.now()
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since1d = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: events30d },
    { data: sessions },
    { count: totalLeads },
    { count: leadsCalificados },
    { count: turnosGenerados },
    { count: protocolosCompatibles },
    { count: requiereHumano },
    { count: handoffCount },
    settings,
  ] = await Promise.all([
    supabase.from("whatsapp_cost_events").select("direction, cost_estimated, currency, created_at, flow_intent, lead_id, wa_id").gte("created_at", since30d).limit(5000),
    supabase.from("whatsapp_sessions").select("phone, state, messages_sent_count, updated_at, lead_id"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("origin_channel", "whatsapp"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("origin_channel", "whatsapp").not("status", "eq", "nuevo"),
    supabase.from("leads").select("id", { count: "exact", head: true }).in("status", ["derivado_cimel", "derivado_swiss", "confirmo_que_pidio_turno"]),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("protocol_interest", true),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("origin_channel", "whatsapp").eq("requires_human", true),
    supabase.from("handoff_events").select("id", { count: "exact", head: true }),
    getWhatsAppSettings(),
  ])

  const rows = (events30d ?? []) as CostEventRow[]
  const outbound = rows.filter(r => r.direction === "outbound")
  const currency = outbound.find(r => r.currency)?.currency ?? "ARS"

  const cost1d = sumCosts(outbound.filter(r => r.created_at >= since1d))
  const cost7d = sumCosts(outbound.filter(r => r.created_at >= since7d))
  const cost30d = sumCosts(outbound)

  const distinctPatients = new Set(rows.map(r => r.wa_id)).size
  const costPerPatient = distinctPatients > 0 ? cost30d.total / distinctPatients : 0
  const costPerLeadCalificado = (leadsCalificados ?? 0) > 0 ? cost30d.total / (leadsCalificados ?? 1) : 0
  const costPerTurno = (turnosGenerados ?? 0) > 0 ? cost30d.total / (turnosGenerados ?? 1) : 0
  const costPerProtocolo = (protocolosCompatibles ?? 0) > 0 ? cost30d.total / (protocolosCompatibles ?? 1) : 0

  const flowTotals = new Map<string, { cost: number; count: number }>()
  for (const row of outbound) {
    const key = row.flow_intent ?? "sin_clasificar"
    const entry = flowTotals.get(key) ?? { cost: 0, count: 0 }
    entry.cost += row.cost_estimated ?? 0
    entry.count += 1
    flowTotals.set(key, entry)
  }
  const flowRanking = [...flowTotals.entries()]
    .map(([flow, data]) => ({ flow, ...data }))
    .sort((a, b) => b.cost - a.cost || b.count - a.count)
    .slice(0, 6)

  const activeSessions = (sessions ?? []).filter(s => s.messages_sent_count > 0)
  const avgMessagesPerConversation = activeSessions.length > 0
    ? activeSessions.reduce((sum, s) => sum + s.messages_sent_count, 0) / activeSessions.length
    : 0

  const conversationsOverWarning = activeSessions.filter(s => s.messages_sent_count >= settings.warning_message_threshold)
  const conversationsOverHandoff = activeSessions.filter(s => s.messages_sent_count >= settings.handoff_message_threshold)

  const staleCutoff = new Date(now - 2 * 60 * 60 * 1000).toISOString()
  const abandonedConversations = (sessions ?? []).filter(
    s => s.state !== "derivado" && s.updated_at < staleCutoff
  ).length

  const unclearIntents = outbound.filter(r => r.flow_intent === "otro_no_entendido").length

  const projectedMonthlyCost = cost1d.total * 30
  const overBudget = settings.monthly_cost_alert_ars !== null && projectedMonthlyCost > settings.monthly_cost_alert_ars

  return {
    currency,
    cost1d, cost7d, cost30d,
    costPerPatient, costPerLeadCalificado, costPerTurno, costPerProtocolo,
    flowRanking,
    avgMessagesPerConversation,
    conversationsOverWarning: conversationsOverWarning.length,
    conversationsOverHandoff: conversationsOverHandoff.length,
    abandonedConversations,
    unclearIntents,
    totalLeads: totalLeads ?? 0,
    leadsCalificados: leadsCalificados ?? 0,
    turnosGenerados: turnosGenerados ?? 0,
    protocolosCompatibles: protocolosCompatibles ?? 0,
    requiereHumano: requiereHumano ?? 0,
    handoffCount: handoffCount ?? 0,
    projectedMonthlyCost,
    overBudget,
    settings,
  }
}

function Money({ amount, currency, pending }: { amount: number; currency: string; pending?: number }) {
  return (
    <span>
      {currency} {amount.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
      {!!pending && <span className="ml-1 text-xs text-amber-600">(+{pending} sin tarifa)</span>}
    </span>
  )
}

export default async function CostosPage() {
  const data = await getCostsData()

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Costos de WhatsApp</h1>
        <p className="text-sm text-gray-500">Estimado según whatsapp_pricing_rules — completá los montos reales en Configuración</p>
      </div>

      {data.overBudget && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Proyección mensual (<Money amount={data.projectedMonthlyCost} currency={data.currency} />) supera el tope configurado de {data.currency} {data.settings.monthly_cost_alert_ars}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Últimas 24 h</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold text-gray-900"><Money amount={data.cost1d.total} currency={data.currency} pending={data.cost1d.pending} /></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Últimos 7 días</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold text-gray-900"><Money amount={data.cost7d.total} currency={data.currency} pending={data.cost7d.pending} /></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Últimos 30 días</CardTitle>
          </CardHeader>
          <CardContent><p className="text-2xl font-bold text-gray-900"><Money amount={data.cost30d.total} currency={data.currency} pending={data.cost30d.pending} /></p></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-gray-500">Costo por paciente</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold text-gray-900"><Money amount={data.costPerPatient} currency={data.currency} /></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-gray-500">Costo por lead calificado</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold text-gray-900"><Money amount={data.costPerLeadCalificado} currency={data.currency} /></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-gray-500">Costo por turno generado</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold text-gray-900"><Money amount={data.costPerTurno} currency={data.currency} /></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-gray-500">Costo por protocolo</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-bold text-gray-900"><Money amount={data.costPerProtocolo} currency={data.currency} /></p></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Flows más caros (30 días)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.flowRanking.length === 0 && <p className="text-sm text-gray-400">Sin datos todavía</p>}
            {data.flowRanking.map(f => (
              <div key={f.flow} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{f.flow}</span>
                <span className="font-medium text-gray-900"><Money amount={f.cost} currency={data.currency} /> <span className="text-gray-400">({f.count} msj)</span></span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Eficiencia de conversación</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-700">Mensajes promedio por conversación</span><span className="font-medium">{data.avgMessagesPerConversation.toFixed(1)}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Conversaciones sobre el aviso ({data.settings.warning_message_threshold} msj)</span><span className="font-medium">{data.conversationsOverWarning}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Conversaciones que gatillaron derivación ({data.settings.handoff_message_threshold}+ msj)</span><span className="font-medium">{data.conversationsOverHandoff}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Conversaciones abandonadas</span><span className="font-medium">{data.abandonedConversations}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Intents no entendidos</span><span className="font-medium">{data.unclearIntents}</span></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Funnel de WhatsApp</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-700">Leads iniciados por WhatsApp</span><span className="font-medium">{data.totalLeads}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Leads calificados</span><span className="font-medium">{data.leadsCalificados}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Turnos generados</span><span className="font-medium">{data.turnosGenerados}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">Compatibles con protocolo</span><span className="font-medium">{data.protocolosCompatibles}</span></div>
            <div className="flex justify-between"><span className="text-gray-700">% derivado a humano</span><span className="font-medium">{data.totalLeads > 0 ? Math.round((data.requiereHumano / data.totalLeads) * 100) : 0}%</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HelpCircle className="h-4 w-4" /> Configuración activa</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between items-center"><span className="text-gray-700">Modo ahorro</span><Badge variant={data.settings.cost_saving_mode ? "success" : "secondary"}>{data.settings.cost_saving_mode ? "Activo" : "Inactivo"}</Badge></div>
            <div className="flex justify-between items-center"><span className="text-gray-700">Cobro de mensajes service (oct 2026)</span><Badge variant={data.settings.enable_service_message_charging ? "warning" : "secondary"}>{data.settings.enable_service_message_charging ? "Simulando" : "Inactivo"}</Badge></div>
            <div className="flex justify-between"><span className="text-gray-700">Derivaciones a humano registradas</span><span className="font-medium">{data.handoffCount}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
