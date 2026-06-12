import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, CheckCircle2, AlertTriangle, Clock,
  MapPin, Camera, Search, MessageSquare
} from "lucide-react"
import { STATUS_LABELS, STATUS_COLORS, type Lead } from "@/types"
import { timeAgo } from "@/lib/utils"
import Link from "next/link"

async function getDashboardData() {
  const supabase = await createClient()

  const [
    { data: leads },
    { data: recentLeads },
  ] = await Promise.all([
    supabase.from("leads").select("*"),
    supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(5),
  ])

  const all = (leads ?? []) as Lead[]

  const metrics = {
    total: all.length,
    confirmed: all.filter(l => l.confirmed_booked).length,
    requires_human: all.filter(l => l.requires_human).length,
    emergencies: all.filter(l => l.possible_emergency).length,
    followup_pending: all.filter(l => l.status === "seguimiento_pendiente").length,
    derivado_cimel: all.filter(l => l.status === "derivado_cimel").length,
    derivado_swiss: all.filter(l => l.status === "derivado_swiss").length,
    by_channel: {
      google_maps: all.filter(l => l.origin_channel === "google_maps").length,
      google_search: all.filter(l => l.origin_channel === "google_search").length,
      instagram: all.filter(l => l.origin_channel === "instagram").length,
      whatsapp: all.filter(l => l.origin_channel === "whatsapp").length,
      manual: all.filter(l => l.origin_channel === "manual").length,
    },
    consulta: all.filter(l => l.requested_service === "consulta_cardiologia").length,
    eco: all.filter(l => l.requested_service === "ecocardiograma").length,
  }

  const conversionRate = metrics.total > 0
    ? Math.round((metrics.confirmed / metrics.total) * 100)
    : 0

  return { metrics, conversionRate, recentLeads: (recentLeads ?? []) as Lead[] }
}

export default async function DashboardPage() {
  const { metrics, conversionRate, recentLeads } = await getDashboardData()

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Resumen de adquisición de pacientes</p>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
    </div>
  )
}
