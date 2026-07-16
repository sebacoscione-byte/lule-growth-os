import { getServiceDb } from "@/lib/supabase/service"
import type { LeadStatus, WhatsAppSettings } from "@/types"
import { z } from "zod"

export type { WhatsAppSettings }

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  bot_enabled: true,
  session_ttl_hours: 24,
  shadow_mode_enabled: false,
  policy_rollout_percent: 0,
  cost_saving_mode: false,
  enable_service_message_charging: false,
  warning_message_threshold: 8,
  handoff_message_threshold: 12,
  monthly_cost_alert_ars: null,
  ai_provider: "sin_ia",
}

export const whatsAppSettingsSchema = z.object({
  bot_enabled: z.boolean(),
  session_ttl_hours: z.number().int().min(1).max(168),
  shadow_mode_enabled: z.boolean(),
  policy_rollout_percent: z.number().int().min(0).max(100),
  cost_saving_mode: z.boolean(),
  enable_service_message_charging: z.boolean(),
  warning_message_threshold: z.number().int().min(1).max(100),
  handoff_message_threshold: z.number().int().min(1).max(100),
  monthly_cost_alert_ars: z.number().min(0).nullable(),
  ai_provider: z.enum(["sin_ia", "gemini", "anthropic", "openai", "otro_llm", "meta_business_agent"]),
}).strict()

/** Punto 9: el flag de octubre 2026 fuerza el modo ahorro, sin importar lo que haya guardado el usuario. */
export function mergeWhatsAppSettings(stored: Partial<WhatsAppSettings> | null | undefined): WhatsAppSettings {
  const candidate = { ...DEFAULT_WHATSAPP_SETTINGS, ...(stored ?? {}) }
  candidate.session_ttl_hours = Math.min(168, Math.max(1, Number(candidate.session_ttl_hours) || 24))
  // La política v2 todavía es un artefacto offline. Estos campos se conservan para poder leer
  // configuraciones previas, pero no pueden activar un rollout que el runtime aún no ejecuta.
  candidate.shadow_mode_enabled = false
  candidate.policy_rollout_percent = 0
  const parsed = whatsAppSettingsSchema.safeParse(candidate)
  const merged = parsed.success ? parsed.data : { ...DEFAULT_WHATSAPP_SETTINGS, bot_enabled: false }
  if (merged.enable_service_message_charging) merged.cost_saving_mode = true
  return merged
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  try {
    const db = getServiceDb()
    const { data, error } = await db
      .from("app_config")
      .select("value")
      .eq("key", "whatsapp_settings")
      .maybeSingle()

    // Un fallo de configuración no debe encender automatización por accidente.
    if (error || !data) return { ...DEFAULT_WHATSAPP_SETTINGS, bot_enabled: false }
    return mergeWhatsAppSettings(data?.value as Partial<WhatsAppSettings> | undefined)
  } catch {
    return { ...DEFAULT_WHATSAPP_SETTINGS, bot_enabled: false }
  }
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
