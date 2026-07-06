import { getServiceDb } from "@/lib/supabase/service"
import type { LeadStatus, WhatsAppSettings } from "@/types"

export type { WhatsAppSettings }

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  cost_saving_mode: false,
  enable_service_message_charging: false,
  warning_message_threshold: 8,
  handoff_message_threshold: 12,
  monthly_cost_alert_ars: null,
  ai_provider: "sin_ia",
}

/** Punto 9: el flag de octubre 2026 fuerza el modo ahorro, sin importar lo que haya guardado el usuario. */
export function mergeWhatsAppSettings(stored: Partial<WhatsAppSettings> | null | undefined): WhatsAppSettings {
  const merged = { ...DEFAULT_WHATSAPP_SETTINGS, ...(stored ?? {}) }
  if (merged.enable_service_message_charging) merged.cost_saving_mode = true
  return merged
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  const db = getServiceDb()
  const { data } = await db
    .from("app_config")
    .select("value")
    .eq("key", "whatsapp_settings")
    .maybeSingle()

  return mergeWhatsAppSettings(data?.value as Partial<WhatsAppSettings> | undefined)
}

/** Punto 9: warning a partir del threshold de aviso; handoff forzado al superar el threshold de derivacion, salvo alto valor. */
export function shouldForceHandoff(messagesSentCount: number, handoffThreshold: number, isHighValue: boolean): boolean {
  return messagesSentCount >= handoffThreshold && !isHighValue
}

export function isNearMessageLimit(messagesSentCount: number, warningThreshold: number): boolean {
  return messagesSentCount >= warningThreshold
}

export function isHighValueLead(lead: {
  status: LeadStatus
  protocol_interest: boolean
  possible_emergency: boolean
} | null): boolean {
  if (!lead) return false
  return (
    lead.status === "derivado_cimel" ||
    lead.status === "derivado_swiss" ||
    lead.status === "derivado_britanico" ||
    lead.status === "confirmo_que_pidio_turno" ||
    lead.protocol_interest ||
    lead.possible_emergency
  )
}
