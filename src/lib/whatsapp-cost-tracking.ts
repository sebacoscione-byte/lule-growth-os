import { getServiceDb } from "@/lib/supabase/service"
import { resolvePriceFromDb } from "@/lib/whatsapp-pricing"
import type { WhatsAppCategory, WhatsAppDirection, WhatsAppEntryPoint, WhatsAppWindowState } from "@/types"

export interface LogMessageParams {
  phoneNumberId?: string | null
  waId: string
  leadId?: string | null
  direction: WhatsAppDirection
  messageType: string
  category: WhatsAppCategory
  isTemplate: boolean
  templateName?: string | null
  windowState: WhatsAppWindowState
  entryPoint: WhatsAppEntryPoint
  content: string
  flowIntent?: string | null
  waMessageId?: string | null
  serviceMessageChargingEnabled: boolean
}

export async function logWhatsAppMessage(params: LogMessageParams): Promise<{ costEstimated: number | null }> {
  const db = getServiceDb()
  const inWindow = params.windowState === "open"

  // Meta nunca cobra los mensajes que envia el paciente — solo lo que la empresa envia.
  const price = params.direction === "inbound"
    ? { cost: 0, currency: null, billable: false }
    : await resolvePriceFromDb(
        {
          countryCode: "AR",
          category: params.category,
          isTemplate: params.isTemplate,
          inWindow,
          entryPoint: params.entryPoint,
        },
        params.serviceMessageChargingEnabled
      )
  const costEstimated = price.billable ? price.cost : 0

  await db.from("whatsapp_cost_events").insert({
    phone_number_id: params.phoneNumberId ?? null,
    wa_id: params.waId,
    lead_id: params.leadId ?? null,
    direction: params.direction,
    message_type: params.messageType,
    category: params.category,
    is_template: params.isTemplate,
    template_name: params.templateName ?? null,
    in_window: inWindow,
    entry_point: params.entryPoint,
    char_count: params.content.length,
    cost_estimated: costEstimated,
    currency: price.currency,
    flow_intent: params.flowIntent ?? null,
    window_state: params.windowState,
  })

  if (params.leadId) {
    await db.from("messages").insert({
      lead_id: params.leadId,
      role: params.direction === "inbound" ? "user" : "assistant",
      content: params.content,
      direction: params.direction,
      wa_message_id: params.waMessageId ?? null,
      category: params.category,
      template_name: params.templateName ?? null,
      window_state: params.windowState,
      flow_intent: params.flowIntent ?? null,
      cost_estimated: costEstimated,
    })
  }

  return { costEstimated }
}

/** Volumen bajo y procesamiento secuencial por webhook: read-then-write es aceptable, no hace falta un RPC atómico. */
export async function incrementMessagesSentCount(phone: string): Promise<number> {
  const db = getServiceDb()
  const { data } = await db
    .from("whatsapp_sessions")
    .select("messages_sent_count")
    .eq("phone", phone)
    .single()

  const next = (data?.messages_sent_count ?? 0) + 1
  await db.from("whatsapp_sessions").update({ messages_sent_count: next }).eq("phone", phone)
  return next
}

export async function resetMessagesSentCount(phone: string): Promise<void> {
  const db = getServiceDb()
  await db.from("whatsapp_sessions").update({ messages_sent_count: 0 }).eq("phone", phone)
}
