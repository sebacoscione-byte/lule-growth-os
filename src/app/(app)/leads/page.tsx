import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Plus, AlertTriangle, Clock, ChevronRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  STATUS_LABELS, STATUS_COLORS, CHANNEL_LABELS, SERVICE_LABELS,
  type Lead,
} from "@/types"
import { timeAgo } from "@/lib/utils"

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; service?: string; q?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(300)

  if (sp.status) query = query.eq("status", sp.status)
  if (sp.channel) query = query.eq("origin_channel", sp.channel)
  if (sp.service) query = query.eq("requested_service", sp.service)
  if (sp.q) query = query.or(`name.ilike.%${sp.q}%,phone.ilike.%${sp.q}%,instagram_username.ilike.%${sp.q}%`)

  const { data: leads } = await query
  const all = (leads ?? []) as Lead[]

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">{all.length} lead{all.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/leads/export" download>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Exportar CSV</span>
            </Button>
          </a>
          <Link href="/leads/nuevo">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="ml-1">Nuevo lead</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Filtros — scroll horizontal en móvil */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
        <Link href="/leads" className="shrink-0">
          <Button variant={!sp.status && !sp.channel && !sp.service ? "default" : "outline"} size="sm">
            Todos
          </Button>
        </Link>
        <Link href="/leads?status=nuevo" className="shrink-0">
          <Button variant={sp.status === "nuevo" ? "default" : "outline"} size="sm">Nuevos</Button>
        </Link>
        <Link href="/leads?status=seguimiento_pendiente" className="shrink-0">
          <Button variant={sp.status === "seguimiento_pendiente" ? "default" : "outline"} size="sm">
            Seguimiento
          </Button>
        </Link>
        <Link href="/leads?status=requiere_humano" className="shrink-0">
          <Button variant={sp.status === "requiere_humano" ? "default" : "outline"} size="sm">
            Atención
          </Button>
        </Link>
        <Link href="/leads?status=confirmo_que_pidio_turno" className="shrink-0">
          <Button variant={sp.status === "confirmo_que_pidio_turno" ? "default" : "outline"} size="sm">
            Confirmaron
          </Button>
        </Link>
      </div>

      {all.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-400">
          <p className="text-lg font-medium">No hay leads todavía</p>
          <p className="text-sm mt-1">Creá el primero desde el botón &ldquo;Nuevo lead&rdquo;</p>
        </div>
      ) : (
        <>
          {/* Cards en móvil */}
          <div className="space-y-2 md:hidden">
            {all.map((lead) => (
              <Link key={lead.id} href={`/leads/${lead.id}`}>
                <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between active:bg-gray-50">
                  <div className="flex items-center gap-2 min-w-0">
                    {(lead.possible_emergency || lead.requires_human) && (
                      <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                    )}
                    {lead.followup_due_at && lead.status === "seguimiento_pendiente" && (
                      <Clock className="h-4 w-4 text-orange-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate text-sm">
                        {lead.name ?? lead.instagram_username ?? lead.phone ?? "Anónimo"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {CHANNEL_LABELS[lead.origin_channel]} · {SERVICE_LABELS[lead.requested_service]}
                      </p>
                      {lead.phone && <p className="truncate text-xs text-gray-400">{lead.phone}</p>}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[lead.status]}`}>
                          {STATUS_LABELS[lead.status]}
                        </span>
                        <span className="text-xs text-gray-400">{timeAgo(lead.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 shrink-0 ml-2" />
                </div>
              </Link>
            ))}
          </div>

          {/* Tabla en desktop */}
          <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Lead</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Canal</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Servicio</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Hace</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {(lead.possible_emergency || lead.requires_human) && (
                          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        {lead.followup_due_at && lead.status === "seguimiento_pendiente" && (
                          <Clock className="h-4 w-4 text-orange-500 shrink-0" />
                        )}
                        <div>
                          <p className="font-medium text-gray-900">
                            {lead.name ?? lead.instagram_username ?? lead.phone ?? "Anónimo"}
                          </p>
                          {lead.phone && <p className="text-xs text-gray-400">{lead.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {CHANNEL_LABELS[lead.origin_channel]}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {SERVICE_LABELS[lead.requested_service]}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {timeAgo(lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`}>
                        <Button variant="ghost" size="sm">Ver</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
