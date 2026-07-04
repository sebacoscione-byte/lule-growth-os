import { getServiceDb } from "@/lib/supabase/service"
import type { HandoffReason } from "@/types"

export interface HandoffLeadInfo {
  id: string
  name: string | null
  insurance: string | null
  patient_age: number | null
  general_reason: string | null
  possible_emergency: boolean
  protocol_interest: boolean
  protocol_name: string | null
  last_message: string | null
}

export interface HandoffSummary {
  nombre: string
  telefono: string
  motivo: string
  cobertura: string
  edad: number | null
  urgencia: "Urgencia" | "No urgente"
  protocolo_posible: string
  ultimo_mensaje: string | null
  mensajes_enviados: number
  costo_estimado: number | null
  proximo_paso_recomendado: string
}

export function buildHandoffSummary(params: {
  phone: string
  lead: HandoffLeadInfo | null
  messagesSentCount: number
  costEstimatedTotal: number | null
  nextStepHint: string
}): HandoffSummary {
  const { lead } = params
  return {
    nombre: lead?.name ?? "Sin nombre",
    telefono: params.phone,
    motivo: lead?.general_reason ?? "No especificado",
    cobertura: lead?.insurance ?? "No informada",
    edad: lead?.patient_age ?? null,
    urgencia: lead?.possible_emergency ? "Urgencia" : "No urgente",
    protocolo_posible: lead?.protocol_interest ? (lead.protocol_name ?? "Sí") : "No",
    ultimo_mensaje: lead?.last_message ?? null,
    mensajes_enviados: params.messagesSentCount,
    costo_estimado: params.costEstimatedTotal,
    proximo_paso_recomendado: params.nextStepHint,
  }
}

export async function escalateToHuman(params: {
  leadId: string | null
  reason: HandoffReason
  summary: HandoffSummary
}): Promise<void> {
  const db = getServiceDb()

  await db.from("handoff_events").insert({
    lead_id: params.leadId,
    reason: params.reason,
    summary: params.summary,
    messages_sent_count: params.summary.mensajes_enviados,
    cost_estimated_total: params.summary.costo_estimado,
  })

  if (params.leadId) {
    await db
      .from("leads")
      .update({ requires_human: true, ai_summary: JSON.stringify(params.summary) })
      .eq("id", params.leadId)
  }
}
