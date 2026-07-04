"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { STATUS_LABELS, STATUS_COLORS, type LeadStatus } from "@/types"
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react"

const ALL_STATUSES: LeadStatus[] = [
  "nuevo", "interesado", "calificado", "derivado_cimel", "derivado_swiss",
  "seguimiento_pendiente", "confirmo_que_pidio_turno", "no_pudo_pedir_turno",
  "requiere_humano", "urgencia_derivada", "descartado", "spam", "elegible_protocolo",
]

export function LeadStatusEditor({
  leadId,
  currentStatus,
  followupDueAt,
}: {
  leadId: string
  currentStatus: LeadStatus
  followupDueAt?: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<LeadStatus>(currentStatus)
  const [saving, setSaving] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null)

  async function save(newStatus: LeadStatus, extra?: Record<string, unknown>) {
    setSaving(true)
    setPendingStatus(null)
    const body: Record<string, unknown> = { status: newStatus, ...extra }
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setStatus(newStatus)
    setSaving(false)
    router.refresh()
  }

  function handleStatusChange(newStatus: LeadStatus) {
    if (newStatus === "seguimiento_pendiente") {
      setPendingStatus(newStatus)
    } else if (newStatus === "confirmo_que_pidio_turno") {
      save(newStatus, { confirmed_booked: true })
    } else if (newStatus === "no_pudo_pedir_turno") {
      save(newStatus, { requires_human: true })
    } else {
      save(newStatus)
    }
  }

  const followupDate = followupDueAt ? new Date(followupDueAt) : null
  const isOverdue = followupDate && followupDate < new Date()

  const isTerminal =
    status === "confirmo_que_pidio_turno" || status === "no_pudo_pedir_turno"

  return (
    <div className="space-y-3">
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
        {STATUS_LABELS[status]}
      </span>

      {/* Acciones rápidas de cierre — solo visibles cuando el lead está activo */}
      {!isTerminal && status !== "descartado" && status !== "spam" && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-green-300 text-green-700 hover:bg-green-50 text-xs"
            disabled={saving}
            onClick={() => save("confirmo_que_pidio_turno", { confirmed_booked: true })}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Ya pidió turno
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50 text-xs"
            disabled={saving}
            onClick={() => save("no_pudo_pedir_turno", { requires_human: true })}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            No pudo pedir
          </Button>
        </div>
      )}

      <Select value={status} onValueChange={(v) => handleStatusChange(v as LeadStatus)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALL_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pendingStatus === "seguimiento_pendiente" && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-2">
          <p className="text-xs font-medium text-orange-800 flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> ¿Cuándo hacer seguimiento?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => save("seguimiento_pendiente", { followup_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })}>
              24 horas
            </Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => save("seguimiento_pendiente", { followup_due_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })}>
              48 horas
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-full text-xs text-gray-500" onClick={() => { setPendingStatus(null); save("seguimiento_pendiente") }}>
            Sin fecha
          </Button>
        </div>
      )}

      {followupDate && status === "seguimiento_pendiente" && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${isOverdue ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-700 border border-orange-200"}`}>
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {isOverdue ? "Vencido: " : "Seguimiento: "}
          {followupDate.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      {saving && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
    </div>
  )
}
