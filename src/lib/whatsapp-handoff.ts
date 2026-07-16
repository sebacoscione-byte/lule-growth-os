import { createHash } from "node:crypto"
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
  entrega_ambigua: "La entrega de una respuesta quedó en estado ambiguo y requiere revisión",
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

interface HandoffEscalationParams {
  leadId: string | null
  reason: HandoffReason
  summary: HandoffSummary
  sourceWaMessageId?: string | null
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

export function formatHandoffAlertText(reason: HandoffReason, leadId: string | null): string {
  const priority = reason === "urgencia_medica" ? "Alta" : "Normal"
  const lines = [
    `Tipo: ${HANDOFF_REASON_LABELS[reason]}`,
    `Prioridad: ${priority}`,
    `Referencia: ${leadId ? `caso ${leadId.slice(0, 8)}` : "caso sin ficha"}`,
    `Abrir Inbox: ${PUBLIC_SITE_ORIGIN}/inbox`,
  ]
  return lines.filter((line): line is string => line !== null).join("\n")
}

async function sendHandoffNotifications(params: HandoffEscalationParams): Promise<void> {
  await sendHandoffAlert(formatHandoffAlertText(params.reason, params.leadId))
  await sendInternalWhatsAppAlert(
    params.sourceWaMessageId
      ?? `${params.leadId ?? "unlinked"}:${params.reason}:${Math.floor(Date.now() / (HANDOFF_ALERT_THROTTLE_MINUTES * 60_000))}`
  )
}

/** Returns a deferred notifier only when requested and when this event actually needs one. */
export async function escalateToHuman(
  params: HandoffEscalationParams,
  options: { deferNotifications?: boolean } = {}
): Promise<(() => Promise<void>) | null> {
  const db = getServiceDb()

  let recentlyAlerted = false
  if (params.leadId) {
    const { data: recent } = await db
      .from("handoff_events")
      .select("created_at")
      .eq("lead_id", params.leadId)
      .eq("reason", params.reason)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (recent?.created_at) {
      const minutesSince = (Date.now() - new Date(recent.created_at).getTime()) / 60_000
      recentlyAlerted = minutesSince < HANDOFF_ALERT_THROTTLE_MINUTES
    }
  }

  // La pausa, el evento y la marca del lead se escriben en una sola transacción de base. Las
  // alertas externas se mandan únicamente después de que esa operación durable tuvo éxito.
  const { data: handoffCreated, error: handoffError } = await db.rpc("create_whatsapp_handoff", {
    p_phone: params.summary.telefono,
    p_lead_id: params.leadId,
    p_reason: params.reason,
    p_summary: params.summary,
    p_messages_sent_count: params.summary.mensajes_enviados,
    p_cost_estimated_total: params.summary.costo_estimado,
    p_source_wa_message_id: params.sourceWaMessageId ?? null,
  })
  if (handoffError) throw new Error("No se pudo registrar y pausar la derivación")

  if (handoffCreated === false || recentlyAlerted) return null
  if (options.deferNotifications) return () => sendHandoffNotifications(params)
  await sendHandoffNotifications(params)
  return null
}

async function sendInternalWhatsAppAlert(stableReference: string): Promise<void> {
  const to = process.env.ALERT_WHATSAPP_TO
  if (!to) return // fail-open: sin número configurado, no manda nada (igual que el resto de las alertas)

  try {
    const template = await getApprovedTemplate(INTERNAL_ALERT_TEMPLATE_NAME)
    if (!template) return // fail-open: template todavía no aprobado por Meta
    const settings = await getWhatsAppSettings()
    const caseReference = `CASO-${createHash("sha256").update(stableReference).digest("hex").slice(0, 8).toUpperCase()}`
    await sendTemplate(to, INTERNAL_ALERT_TEMPLATE_NAME, template.language, [caseReference], {
      windowState: "closed",
      entryPoint: "organic",
      leadId: null,
      deliveryKey: `handoff-alert:${caseReference}`,
      outboundStep: "internal_handoff_alert",
      flowIntent: "internal_handoff_alert",
      serviceMessageChargingEnabled: settings.enable_service_message_charging,
    })
  } catch (error) {
    console.error("Error mandando alerta interna de WhatsApp", error instanceof Error ? error.name : "unknown_error")
    // No relanza -- el email ya se mandó (o se intentó) arriba, este es un canal adicional.
  }
}

// La primera respuesta manual significa que el equipo tomó la conversación. Resolver/reactivar y
// cerrar son acciones separadas: responder nunca vuelve a encender el bot implícitamente.
type HandoffTransition = "take" | "reactivate" | "close"

async function transitionHandoffForLead(leadId: string, actor: string, action: HandoffTransition): Promise<void> {
  const db = getServiceDb()
  const { error } = await db.rpc("transition_whatsapp_handoff", {
    p_lead_id: leadId,
    p_action: action,
    p_actor: actor,
  })
  if (error) throw new Error("No se pudo actualizar la derivación")
}

/** La primera respuesta manual toma la conversación, pero no la cierra ni reactiva al bot. */
export async function takeHandoffForLead(leadId: string, takenBy: string): Promise<void> {
  await transitionHandoffForLead(leadId, takenBy, "take")
}

/** Cierra el handoff y permite que el bot vuelva al último estado seguro de la conversación. */
export async function resolveHandoffForLead(leadId: string, resolvedBy: string): Promise<void> {
  await transitionHandoffForLead(leadId, resolvedBy, "reactivate")
}

/** Cierra la conversación sin permitir nuevas respuestas automáticas hasta una reactivación manual. */
export async function closeHandoffForLead(leadId: string, closedBy: string): Promise<void> {
  await transitionHandoffForLead(leadId, closedBy, "close")
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

    const lines = stale.map(([leadId, h]) =>
      `- Caso ${leadId.slice(0, 8)} — esperando ${timeAgo(h.createdAt)} — ${HANDOFF_REASON_LABELS[h.reason]} — ${PUBLIC_SITE_ORIGIN}/inbox?lead_id=${leadId}`
    )
    await sendHandoffReminderAlert(lines.join("\n"))
    return { pending: stale.length }
  } catch {
    return { pending: 0, error: "handoff_reminder_failed" }
  }
}
