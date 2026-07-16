import type { SupabaseClient } from "@supabase/supabase-js"
import { sendTemplate } from "@/lib/whatsapp"
import { getApprovedTemplate } from "@/lib/whatsapp-templates"
import { getWindowState } from "@/lib/whatsapp-window"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { FOLLOWUP_CONSENT_PURPOSE, FOLLOWUP_CONSENT_VERSION } from "@/lib/whatsapp-consent"
import type { WhatsAppEntryPoint } from "@/types"

const FOLLOWUP_ELIGIBLE_STATUSES = ["derivado_cimel", "derivado_swiss", "derivado_britanico", "seguimiento_pendiente"]
const TEMPLATE_NAME = "recontacto_incompleto"

export interface WhatsAppFollowupResult {
  sent: number
  skipped: number
  errors: string[]
}

/**
 * Reintenta contacto por WhatsApp con leads que quedaron sin confirmar turno (followup_due_at
 * vencido), vía el template "recontacto_incompleto" -- el único de los 9 templates obligatorios
 * (ver CLAUDE.md) que encaja con este flujo sin necesitar una fecha de turno real (la app no
 * reserva turnos, así que "recordatorio_turno" no aplica acá). Usa siempre sendTemplate, nunca
 * sendText: es un mensaje iniciado por el negocio fuera de una conversación activa, así que
 * corresponde template sin importar si la ventana de 24h está abierta o cerrada.
 */
export async function runWhatsAppFollowup(supabase: SupabaseClient, now: Date): Promise<WhatsAppFollowupResult> {
  const settings = await getWhatsAppSettings()
  if (settings.bot_enabled === false) return { sent: 0, skipped: 0, errors: [] }

  const template = await getApprovedTemplate(TEMPLATE_NAME)
  if (!template) {
    return { sent: 0, skipped: 0, errors: [`Template "${TEMPLATE_NAME}" todavía no está aprobado en Meta`] }
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, phone")
    .lte("followup_due_at", now.toISOString())
    .in("status", FOLLOWUP_ELIGIBLE_STATUSES)
    .eq("consent_to_contact", true)
    .eq("requires_human", false)
    .eq("whatsapp_followup_status", "pending")
    .is("whatsapp_followup_sent_at", null)
    .not("phone", "is", null)

  if (error) return { sent: 0, skipped: 0, errors: ["followup_lookup_failed"] }

  let sent = 0
  let skipped = 0
  const errors: string[] = []

  for (const [index, lead] of (leads ?? []).entries()) {
    const candidateRef = `candidate_${index + 1}`
    if (!lead.phone) continue

    // El booleano del lead es solo un índice derivado. La autorización real es siempre la última
    // decisión durable para la finalidad específica de seguimiento de turno.
    const { data: consent, error: consentError } = await supabase
      .from("consent_records")
      .select("consented, version")
      .eq("wa_id", lead.phone)
      .eq("purpose", FOLLOWUP_CONSENT_PURPOSE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (consentError || consent?.consented !== true || consent.version !== FOLLOWUP_CONSENT_VERSION) {
      skipped++
      continue
    }

    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("last_inbound_at, entry_point, bot_paused, state")
      .eq("phone", lead.phone)
      .maybeSingle()

    if (
      session?.bot_paused ||
      session?.state === "handoff_pending" ||
      session?.state === "human_active" ||
      session?.state === "closed"
    ) {
      skipped++
      continue
    }

    const entryPoint = (session?.entry_point as WhatsAppEntryPoint | undefined) ?? "organic"
    const windowState = getWindowState(session?.last_inbound_at ?? null, entryPoint, now)
    const params = [lead.name ?? "Hola"]

    const { data: claimed, error: claimError } = await supabase.rpc("claim_whatsapp_followup", {
      p_lead_id: lead.id,
      p_now: now.toISOString(),
    })
    if (claimError || claimed !== true) {
      if (claimError) errors.push(`${candidateRef}:followup_claim_failed`)
      else skipped++
      continue
    }

    try {
      await sendTemplate(lead.phone, TEMPLATE_NAME, template.language, params, {
        windowState,
        entryPoint,
        leadId: lead.id,
        deliveryKey: `appointment-followup:${lead.id}:${TEMPLATE_NAME}`,
        outboundStep: "appointment_followup_once",
        serviceMessageChargingEnabled: settings.enable_service_message_charging,
      })

      const { data: completed, error: completeError } = await supabase.rpc("complete_whatsapp_followup", {
        p_lead_id: lead.id,
        p_outcome: "sent",
        p_now: now.toISOString(),
      })
      if (completeError || completed !== true) {
        const { data: quarantined, error: quarantineError } = await supabase.rpc("complete_whatsapp_followup", {
          p_lead_id: lead.id,
          p_outcome: "ambiguous",
          p_now: now.toISOString(),
        })
        errors.push(
          quarantineError || quarantined !== true
            ? `${candidateRef}:followup_completion_and_quarantine_failed`
            : `${candidateRef}:followup_completion_failed`
        )
        continue
      }

      sent++
    } catch {
      const { data: quarantined, error: quarantineError } = await supabase.rpc("complete_whatsapp_followup", {
        p_lead_id: lead.id,
        p_outcome: "ambiguous",
        p_now: now.toISOString(),
      })
      errors.push(
        quarantineError || quarantined !== true
          ? `${candidateRef}:followup_send_and_quarantine_failed`
          : `${candidateRef}:followup_send_failed`
      )
    }
  }

  return { sent, skipped: skipped + errors.length, errors }
}
