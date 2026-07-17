import { createHash, randomUUID } from "node:crypto"
import { getServiceDb } from "@/lib/supabase/service"
import { hashWhatsAppPhone } from "@/lib/whatsapp-webhook-normalizer"
import {
  evaluateWhatsAppPolicy,
  type WhatsAppPolicyInputType,
  type WhatsAppPolicyState,
} from "@/lib/whatsapp-policy"
import { buildWhatsAppPolicyShadowRecord, type ComparableWhatsAppDecision } from "@/lib/whatsapp-policy-shadow"
import { getWhatsAppPolicyCohortBucket } from "@/lib/whatsapp-rollout"
import { classifyIntentDeterministic, classifyProtocolButtonReply } from "@/lib/whatsapp-intents"
import { shouldForceHandoff, isHighValueLead } from "@/lib/whatsapp-settings"
import type { BotState, WhatsAppInboundMessageType } from "@/lib/whatsapp-bot"
import type { LeadStatus } from "@/types"

/**
 * Fase 1 del shadow mode (2026-07-17): compara, sin efecto sobre el paciente, la decisión real del
 * bot legacy contra la del motor v2 (`whatsapp-policy.ts`). Corre desde un único punto de entrada en
 * `handleIncomingMessage`, antes de cualquier rama real, y nunca puede hacer fallar ni demorar la
 * respuesta real: cualquier error queda contenido acá adentro.
 *
 * Cobertura deliberadamente parcial: solo se compara cuando la rama legacy que de verdad se ejecutó
 * es una de las que tiene un equivalente inequívoco en el catálogo v2 (urgencia, baja de contacto,
 * adjunto no soportado, límite clínico, derivación forzada por longitud, pedido explícito de humano,
 * respuesta a botón de protocolo, y los intents deterministicos de `derivado` que sí tienen active
 * un handoff o cierre real). El flujo conversacional de intake/sede/cobertura (la mayoría del
 * volumen) todavía no tiene una etiqueta `response_key` legacy inequívoca — se deja para una fase 2
 * si esta primera fase da señal alentadora, en vez de adivinar una equivalencia que podría no ser
 * real.
 */

const STATE_MAP: Record<BotState, WhatsAppPolicyState> = {
  nuevo: "new",
  esperando_consentimiento: "awaiting_consent",
  intake_pendiente: "awaiting_service",
  esperando_obra_social: "awaiting_coverage",
  esperando_sede: "awaiting_location",
  esperando_seguimiento: "routed",
  derivado: "routed",
  handoff_pending: "handoff_pending",
  human_active: "human_active",
  closed: "closed",
}

const INPUT_TYPE_MAP: Record<WhatsAppInboundMessageType, WhatsAppPolicyInputType> = {
  text: "text",
  button_reply: "button",
  list_reply: "list",
  audio: "audio",
  image: "image",
  document: "document",
  sticker: "sticker",
  video: "video",
  location: "location",
  contacts: "contact",
  unknown: "unknown",
}

export function mapBotStateToPolicyState(state: BotState): WhatsAppPolicyState {
  return STATE_MAP[state]
}

export function mapMessageTypeToInputType(messageType: WhatsAppInboundMessageType): WhatsAppPolicyInputType {
  return INPUT_TYPE_MAP[messageType]
}

const EMERGENCY_DECISION: ComparableWhatsAppDecision = {
  action: "emergency",
  intent: "symptom_question",
  response_key: "possible_emergency",
  handoff: true,
}

export interface LegacySignals {
  emergencyDetected: boolean
  marketingOptOut: boolean
  unsupportedMessage: boolean
  botPaused: boolean
  medicalBoundaryDetected: boolean
  sensitiveMedicalContentDetected: boolean
  botEnabled: boolean
  sessionState: BotState
  forceHandoffTriggered: boolean
  messageType: WhatsAppInboundMessageType
  buttonId?: string
  text: string
}

/**
 * Reconstruye, en el mismo orden de precedencia exacto que `handleIncomingMessage`, qué decisión
 * tomó (o hubiera tomado) el bot legacy. Devuelve `null` cuando la rama real no tiene un equivalente
 * confiable en el catálogo v2 (ver comentario del módulo) — en ese caso no se registra nada.
 */
export function deriveLegacyComparableDecision(signals: LegacySignals): ComparableWhatsAppDecision | null {
  const {
    emergencyDetected, marketingOptOut, unsupportedMessage, botPaused,
    medicalBoundaryDetected, sensitiveMedicalContentDetected, botEnabled,
    sessionState, forceHandoffTriggered, messageType, buttonId, text,
  } = signals

  if (emergencyDetected) return EMERGENCY_DECISION

  if (marketingOptOut) {
    return { action: "opt_out", intent: "unknown", response_key: "opt_out_confirmed", handoff: false }
  }

  if (unsupportedMessage) {
    return { action: "continue", intent: "unsupported_media", response_key: "unsupported_media", handoff: false }
  }

  // El bot pausado no produce ninguna decisión real (no contesta nada) — no hay nada que comparar.
  if (botPaused) return null

  if (medicalBoundaryDetected || sensitiveMedicalContentDetected) {
    return { action: "continue", intent: "unknown", response_key: "medical_boundary", handoff: false }
  }

  // Kill switch global o conversación ya en manos de una persona: legacy tampoco produce una
  // decisión de política acá.
  if (!botEnabled) return null
  if (sessionState === "handoff_pending" || sessionState === "human_active" || sessionState === "closed") return null

  if (forceHandoffTriggered) {
    return { action: "handoff", intent: "unknown", response_key: "human_handoff", handoff: true }
  }

  if (messageType === "button_reply" && buttonId === "hablar_humano") {
    return { action: "handoff", intent: "unknown", response_key: "human_handoff", handoff: true }
  }

  if (messageType === "button_reply" && sessionState !== "esperando_seguimiento") {
    const protocolReply = classifyProtocolButtonReply(text)
    if (protocolReply === "opt_out") {
      return { action: "opt_out", intent: "research_protocol", response_key: "opt_out_protocol", handoff: false }
    }
    if (protocolReply === "opt_in") {
      return { action: "handoff", intent: "research_protocol", response_key: "human_handoff", handoff: true }
    }
  }

  if (sessionState === "derivado" && messageType === "text") {
    const intent = classifyIntentDeterministic(text)
    switch (intent) {
      case "urgencia_medica":
        // Defensivo: en la práctica ya lo captura emergencyDetected más arriba con el mismo texto.
        return EMERGENCY_DECISION
      case "turno_ya_resuelto":
        return { action: "continue", intent: "appointment_already_solved", response_key: "thanks_close", handoff: false }
      case "hablar_con_humano":
        return { action: "handoff", intent: "unknown", response_key: "human_handoff", handoff: true }
      case "cancelar_reprogramar":
        return { action: "handoff", intent: "cancel_or_reschedule", response_key: "show_booking_instructions", handoff: true }
      case "derivar_protocolo":
        return { action: "handoff", intent: "research_protocol", response_key: "human_handoff", handoff: true }
      default:
        return null
    }
  }

  return null
}

function computeEventHash(waMessageId: string | undefined): string {
  const seed = waMessageId ? `wa:${waMessageId}` : `evt:${randomUUID()}`
  return createHash("sha256").update(`whatsapp-policy-shadow-event|${seed}`).digest("hex")
}

export interface WhatsAppPolicyShadowInput {
  phone: string
  text: string
  messageType: WhatsAppInboundMessageType
  buttonId?: string
  waMessageId?: string
  leadId: string | null
  sessionState: BotState
  messagesSentCount: number
  handoffMessageThreshold: number
  emergencyDetected: boolean
  marketingOptOut: boolean
  unsupportedMessage: boolean
  botPaused: boolean
  medicalBoundaryDetected: boolean
  sensitiveMedicalContentDetected: boolean
  botEnabled: boolean
}

/**
 * Punto de entrada único, pensado para llamarse desde `handleIncomingMessage` antes de cualquier
 * rama real. Nunca lanza: cualquier fallo (de red, de validación, de Supabase) queda contenido y
 * solo se loguea, para que un problema acá nunca le impida al bot responderle de verdad al paciente.
 */
export async function evaluateWhatsAppPolicyShadow(input: WhatsAppPolicyShadowInput): Promise<void> {
  try {
    let highValueLead = false
    if (input.leadId) {
      const db = getServiceDb()
      const { data } = await db
        .from("leads")
        .select("status, protocol_interest, possible_emergency")
        .eq("id", input.leadId)
        .maybeSingle()
      if (data) {
        highValueLead = isHighValueLead(
          data as { status: LeadStatus; protocol_interest: boolean; possible_emergency: boolean }
        )
      }
    }
    const forceHandoffTriggered = shouldForceHandoff(
      input.messagesSentCount,
      input.handoffMessageThreshold,
      highValueLead
    )

    const legacy = deriveLegacyComparableDecision({
      emergencyDetected: input.emergencyDetected,
      marketingOptOut: input.marketingOptOut,
      unsupportedMessage: input.unsupportedMessage,
      botPaused: input.botPaused,
      medicalBoundaryDetected: input.medicalBoundaryDetected,
      sensitiveMedicalContentDetected: input.sensitiveMedicalContentDetected,
      botEnabled: input.botEnabled,
      sessionState: input.sessionState,
      forceHandoffTriggered,
      messageType: input.messageType,
      buttonId: input.buttonId,
      text: input.text,
    })
    if (!legacy) return

    const initialState = mapBotStateToPolicyState(input.sessionState)
    const inputType = mapMessageTypeToInputType(input.messageType)
    const candidate = evaluateWhatsAppPolicy({
      state: initialState,
      input_type: inputType,
      text: input.text,
      consecutive_unknown_count: 0,
    })

    const conversationHash = hashWhatsAppPhone(input.phone)
    const record = buildWhatsAppPolicyShadowRecord({
      event_hash: computeEventHash(input.waMessageId),
      conversation_hash: conversationHash,
      initial_state: initialState,
      input_type: inputType,
      legacy,
      candidate,
      rollout_bucket: getWhatsAppPolicyCohortBucket(conversationHash),
      served_by: "legacy",
    })

    const db = getServiceDb()
    const { error } = await db.from("whatsapp_policy_evaluations").insert(record)
    if (error) console.error("whatsapp_policy_shadow_insert_failed", error.message)
  } catch (error) {
    console.error("whatsapp_policy_shadow_failed", error instanceof Error ? error.message : String(error))
  }
}
