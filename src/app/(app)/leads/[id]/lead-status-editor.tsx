"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { STATUS_LABELS, STATUS_COLORS, type LeadStatus } from "@/types"
import { Loader2 } from "lucide-react"

const ALL_STATUSES: LeadStatus[] = [
  "nuevo", "interesado", "calificado", "derivado_cimel", "derivado_swiss",
  "seguimiento_pendiente", "confirmo_que_pidio_turno", "no_pudo_pedir_turno",
  "requiere_humano", "urgencia_derivada", "descartado", "spam",
]

export function LeadStatusEditor({ leadId, currentStatus }: { leadId: string; currentStatus: LeadStatus }) {
  const router = useRouter()
  const [status, setStatus] = useState<LeadStatus>(currentStatus)
  const [saving, setSaving] = useState(false)

  async function save(newStatus: LeadStatus) {
    setSaving(true)
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setStatus(newStatus)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
        {STATUS_LABELS[status]}
      </span>
      <Select value={status} onValueChange={(v) => save(v as LeadStatus)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALL_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saving && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
    </div>
  )
}
