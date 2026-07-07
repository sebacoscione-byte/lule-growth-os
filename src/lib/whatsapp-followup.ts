import type { SupabaseClient } from "@supabase/supabase-js"
import { sendTemplate } from "@/lib/whatsapp"
import { getApprovedTemplate, fillTemplateBody } from "@/lib/whatsapp-templates"
import { getWindowState } from "@/lib/whatsapp-window"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
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
  const template = await getApprovedTemplate(TEMPLATE_NAME)
  if (!template) {
    return { sent: 0, skipped: 0, errors: [`Template "${TEMPLATE_NAME}" todavía no está aprobado en Meta`] }
  }

  const settings = await getWhatsAppSettings()

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, phone")
    .lte("followup_due_at", now.toISOString())
    .in("status", FOLLOWUP_ELIGIBLE_STATUSES)
    .eq("consent_to_contact", true)
    .not("phone", "is", null)

  if (error) return { sent: 0, skipped: 0, errors: [error.message] }

  let sent = 0
  const errors: string[] = []

  for (const lead of leads ?? []) {
    if (!lead.phone) continue

    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("last_inbound_at, entry_point")
      .eq("phone", lead.phone)
      .maybeSingle()

    const entryPoint = (session?.entry_point as WhatsAppEntryPoint | undefined) ?? "organic"
    const windowState = getWindowState(session?.last_inbound_at ?? null, entryPoint, now)
    const params = [lead.name ?? "Hola"]

    try {
      await sendTemplate(lead.phone, TEMPLATE_NAME, template.language, params, {
        windowState,
        entryPoint,
        leadId: lead.id,
        serviceMessageChargingEnabled: settings.enable_service_message_charging,
      })

      await supabase.from("messages").insert({
        lead_id: lead.id,
        role: "assistant",
        content: fillTemplateBody(template, params),
      })

      await supabase.from("leads").update({
        status: "seguimiento_pendiente",
        followup_due_at: null,
      }).eq("id", lead.id)

      sent++
    } catch (err) {
      errors.push(`${lead.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { sent, skipped: errors.length, errors }
}
