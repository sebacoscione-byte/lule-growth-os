import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Plus, AlertTriangle, Clock, ChevronRight, ChevronLeft, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  STATUS_LABELS, STATUS_COLORS, CHANNEL_LABELS, SERVICE_LABELS,
  type Lead,
} from "@/types"
import { timeAgo, sanitizePostgrestValue } from "@/lib/utils"
import { getOpenHandoffs } from "@/lib/whatsapp-handoff"

const PAGE_SIZE = 50

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; channel?: string; service?: string; q?: string; requires_human?: string; page?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  // Antes traía hasta 300 leads en una sola consulta sin ninguna forma de ver los más viejos —
  // PERF-01: se pagina de verdad (range() + count exacto) para que la lista no tenga techo.
  const currentPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const from = (currentPage - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  const isAttentionView = sp.requires_human === "true"

  let query = supabase.from("leads").select("*", { count: "exact" })
  if (!isAttentionView) query = query.order("created_at", { ascending: false })

  if (sp.status) query = query.eq("status", sp.status)
  if (sp.channel) query = query.eq("origin_channel", sp.channel)
  if (sp.service) query = query.eq("requested_service", sp.service)
  if (isAttentionView) query = query.eq("requires_human", true)
  if (sp.q) {
    const safeQ = sanitizePostgrestValue(sp.q)
    if (safeQ) query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,instagram_username.ilike.%${safeQ}%`)
  }

  let all: Lead[]
  let total: number
  const waitByLead = new Map<string, string>()

  if (isAttentionView) {
    // Ola 4 (P2, incidente real 2026-07-14): acá priorizamos por tiempo real de espera (desde que
    // se abrió el handoff), no por fecha de creación del lead. Es un conjunto chico (leads
    // esperando a una persona del equipo), así que se trae completo y se pagina en memoria en vez
    // de sumar una consulta con join a nivel SQL.
    const { data: leads } = await query
    const leadsList = (leads ?? []) as Lead[]
    if (leadsList.length > 0) {
      const openHandoffs = await getOpenHandoffs(leadsList.map(l => l.id))
      for (const [leadId, h] of openHandoffs) waitByLead.set(leadId, h.createdAt)
    }

    leadsList.sort((a, b) => {
      const aWait = waitByLead.get(a.id)
      const bWait = waitByLead.get(b.id)
      if (aWait && bWait) return new Date(aWait).getTime() - new Date(bWait).getTime()
      if (aWait) return -1
      if (bWait) return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    total = leadsList.length
    all = leadsList.slice(from, to + 1)
  } else {
    const { data: leads, count } = await query.range(from, to)
    all = (leads ?? []) as Lead[]
    total = count ?? 0
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(targetPage: number) {
    const params = new URLSearchParams()
    if (sp.status) params.set("status", sp.status)
    if (sp.channel) params.set("channel", sp.channel)
    if (sp.service) params.set("service", sp.service)
    if (sp.requires_human) params.set("requires_human", sp.requires_human)
    if (sp.q) params.set("q", sp.q)
    if (targetPage > 1) params.set("page", String(targetPage))
    const qs = params.toString()
    return qs ? `/leads?${qs}` : "/leads"
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">
            {total} lead{total !== 1 ? "s" : ""}
            {totalPages > 1 && <> · página {currentPage} de {totalPages}</>}
          </p>
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
        <Link href="/leads?requires_human=true" className="shrink-0">
          <Button variant={sp.requires_human === "true" ? "default" : "outline"} size="sm">
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
                        {waitByLead.has(lead.id) ? (
                          <span className="text-xs font-medium text-red-600">Esperando {timeAgo(waitByLead.get(lead.id)!)}</span>
                        ) : (
                          <span className="text-xs text-gray-400">{timeAgo(lead.created_at)}</span>
                        )}
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
                    <td className="px-4 py-3 text-xs">
                      {waitByLead.has(lead.id) ? (
                        <span className="font-medium text-red-600">Esperando {timeAgo(waitByLead.get(lead.id)!)}</span>
                      ) : (
                        <span className="text-gray-400">{timeAgo(lead.created_at)}</span>
                      )}
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

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          {currentPage > 1 ? (
            <Link href={pageHref(currentPage - 1)}>
              <Button variant="outline" size="sm">
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
          )}
          <span className="text-sm text-gray-500">Página {currentPage} de {totalPages}</span>
          {currentPage < totalPages ? (
            <Link href={pageHref(currentPage + 1)}>
              <Button variant="outline" size="sm">
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
