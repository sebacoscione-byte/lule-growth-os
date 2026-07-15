import { getServiceDb } from "@/lib/supabase/service"
import { sendHandoffAlert, sendHandoffReminderAlert } from "@/lib/alert-email"
import { sendTemplate } from "@/lib/whatsapp"
import { getApprovedTemplate } from "@/lib/whatsapp-templates"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { PUBLIC_SITE_ORIGIN } from "@/lib/tracked-links"
import { timeAgo } from "@/lib/utils"
import type { HandoffReason } from "@/types"

// Segundo canal (además del email) para la alerta en tiempo real -- a pedido explícito de Seba
// (2026-07-15), más probable de notarse al toque que un mail. Requiere un template aprobado por
// Meta (`alerta_interna_derivacion`, ver migración `20260715_internal_alert_template.sql`) y el
// número propio configurado -- sin cualquiera de los dos, no manda nada (fail-open, mismo patrón
// que el resto de las alertas del proyecto). No reemplaza el email: si Meta rechaza el template o
// tarda en aprobarlo, el email sigue funcionando igual que antes.
const INTERNAL_ALERT_TEMPLATE_NAME = "alerta_interna_derivacion"

const HANDOFF_REASON_LABELS: Record<HandoffReason, string> = {
  urgencia_medica: "Posible urgencia médica",
  solicitud_explicita: "Pidió hablar con una persona",
  conversacion_larga: "Conversación larga sin resolver",
  intent_no_entendido: "El bot no entendió varias veces",
  sin_template_valido: "No hay template de WhatsApp aprobado para seguir la conversación",
}

// Evita mandar un mail nuevo por cada mensaje de una misma conversación larga (escalateToHuman se
// llama varias veces seguidas en ese caso) -- no es una ventana de deduplicación por evento, es un
// piso mínimo de tiempo entre alertas para el mismo lead.
const HANDOFF_ALERT_THROTTLE_MINUTES = 30

// Respaldo diario (Ola 4): un handoff se considera "sin responder" si nadie lo resolvió (ver
// resolveHandoffForLead) en este tiempo. El cron que corre esta verificación es diario (Vercel
// Hobby), así que esto funciona como red de seguridad ante la alerta puntual perdida/ignorada, no
// como un recordatorio fino a los 30-60 min -- ver docs/BACKLOG.md, Ola 4.
const HANDOFF_REMINDER_STALE_MINUTES = 60

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

function formatHandoffAlertText(reason: HandoffReason, summary: HandoffSummary, leadId: string | null): string {
  const lines = [
    `Motivo: ${HANDOFF_REASON_LABELS[reason]}`,
    `Paciente: ${summary.nombre}`,
    `Teléfono: ${summary.telefono}`,
    `Consulta: ${summary.motivo}`,
    `Cobertura: ${summary.cobertura}`,
    summary.edad ? `Edad: ${summary.edad}` : null,
    `Próximo paso: ${summary.proximo_paso_recomendado}`,
    summary.ultimo_mensaje ? `Último mensaje: "${summary.ultimo_mensaje}"` : null,
    leadId ? `Ver conversación: ${PUBLIC_SITE_ORIGIN}/inbox?lead_id=${leadId}` : null,
  ]
  return lines.filter((line): line is string => line !== null).join("\n")
}

export async function escalateToHuman(params: {
  leadId: string | null
  reason: HandoffReason
  summary: HandoffSummary
}): Promise<void> {
  const db = getServiceDb()

  let recentlyAlerted = false
  if (params.leadId) {
    const { data: recent } = await db
      .from("handoff_events")
      .select("created_at")
      .eq("lead_id", params.leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent?.created_at) {
      const minutesSince = (Date.now() - new Date(recent.created_at).getTime()) / 60_000
      recentlyAlerted = minutesSince < HANDOFF_ALERT_THROTTLE_MINUTES
    }
  }

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

  if (!recentlyAlerted) {
    await sendHandoffAlert(formatHandoffAlertText(params.reason, params.summary, params.leadId))
    await sendInternalWhatsAppAlert(params.summary.nombre, HANDOFF_REASON_LABELS[params.reason])
  }
}

async function sendInternalWhatsAppAlert(nombrePaciente: string, motivo: string): Promise<void> {
  const to = process.env.ALERT_WHATSAPP_TO
  if (!to) return // fail-open: sin número configurado, no manda nada (igual que el resto de las alertas)

  const template = await getApprovedTemplate(INTERNAL_ALERT_TEMPLATE_NAME)
  if (!template) return // fail-open: template todavía no aprobado por Meta

  try {
    const settings = await getWhatsAppSettings()
    await sendTemplate(to, INTERNAL_ALERT_TEMPLATE_NAME, template.language, [nombrePaciente, motivo], {
      windowState: "closed",
      entryPoint: "organic",
      leadId: null,
      serviceMessageChargingEnabled: settings.enable_service_message_charging,
    })
  } catch (error) {
    console.error(
      `Error mandando alerta interna de WhatsApp a ${to}:`,
      error instanceof Error ? error.message : error
    )
    // No relanza -- el email ya se mandó (o se intentó) arriba, este es un canal adicional.
  }
}

// Se llama cuando el equipo responde de verdad al paciente desde el Inbox (ver /api/messages) --
// esa respuesta manual ES la señal de que alguien tomó la conversación, así que cierra el handoff
// sin necesitar un botón aparte. Ver [[feedback_minimize_manual_work]].
export async function resolveHandoffForLead(leadId: string, resolvedBy: string): Promise<void> {
  const db = getServiceDb()
  await db
    .from("handoff_events")
    .update({ resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq("lead_id", leadId)
    .is("resolved_at", null)
  await db.from("leads").update({ requires_human: false }).eq("id", leadId)
}

// Handoffs sin resolver, el más antiguo primero -- una fila por lead (su handoff abierto más
// viejo). Sirve tanto para el respaldo diario por email como para priorizar visualmente en
// Inbox/`/leads` (Ola 4, P2). Sin filtro de leadIds recorre toda la tabla (es chica).
export async function getOpenHandoffs(
  leadIds?: string[]
): Promise<Map<string, { createdAt: string; reason: HandoffReason }>> {
  // `leadIds` distingue "sin filtro" (undefined) de "filtro vacío" (array vacío) -- este último no
  // debe devolver la tabla entera sin querer.
  if (leadIds && leadIds.length === 0) return new Map()

  const db = getServiceDb()
  let query = db
    .from("handoff_events")
    .select("lead_id, reason, created_at")
    .is("resolved_at", null)
    .not("lead_id", "is", null)
    .order("created_at", { ascending: true })
  if (leadIds) query = query.in("lead_id", leadIds)

  const { data } = await query
  const result = new Map<string, { createdAt: string; reason: HandoffReason }>()
  for (const row of data ?? []) {
    if (!row.lead_id || result.has(row.lead_id)) continue
    result.set(row.lead_id, { createdAt: row.created_at, reason: row.reason as HandoffReason })
  }
  return result
}

export interface HandoffReminderResult {
  pending: number
  error?: string
}

// Respaldo diario dentro del cron ya existente (ver Ola 4 del backlog) -- manda un único mail con
// todos los handoffs abiertos hace más de HANDOFF_REMINDER_STALE_MINUTES, por si la alerta puntual
// de escalateToHuman se perdió (Resend caído) o se ignoró.
export async function runHandoffReminderCheck(now: Date): Promise<HandoffReminderResult> {
  try {
    const open = await getOpenHandoffs()
    const stale = [...open.entries()].filter(
      ([, h]) => now.getTime() - new Date(h.createdAt).getTime() >= HANDOFF_REMINDER_STALE_MINUTES * 60_000
    )
    if (stale.length === 0) return { pending: 0 }

    const db = getServiceDb()
    const { data: leads } = await db
      .from("leads")
      .select("id, name, phone")
      .in("id", stale.map(([leadId]) => leadId))
    const leadById = new Map((leads ?? []).map(l => [l.id, l]))

    const lines = stale.map(([leadId, h]) => {
      const lead = leadById.get(leadId)
      return `- ${lead?.name ?? "Sin nombre"} (${lead?.phone ?? "sin teléfono"}) — esperando ${timeAgo(h.createdAt)} — ${HANDOFF_REASON_LABELS[h.reason]} — ${PUBLIC_SITE_ORIGIN}/inbox?lead_id=${leadId}`
    })
    await sendHandoffReminderAlert(lines.join("\n"))
    return { pending: stale.length }
  } catch (error) {
    return { pending: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
