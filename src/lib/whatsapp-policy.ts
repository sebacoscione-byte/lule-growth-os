import { z } from "zod"
import { assessEmergencyMessage } from "@/lib/medical-safety"
import {
  BotNluSchema,
  WHATSAPP_NLU_SCHEMA_VERSION,
  type BotNlu,
  type WhatsAppIntentV2,
} from "@/lib/whatsapp-nlu-schema"

export const WHATSAPP_POLICY_VERSION = "2026-07-16" as const

export const WhatsAppGlobalActionSchema = z.enum([
  "continue",
  "emergency",
  "handoff",
  "opt_out",
  "stop_bot",
  "ask_clarification",
])

export const WhatsAppResponseKeySchema = z.enum([
  "consent_request",
  "consent_declined",
  "ask_service",
  "ask_coverage",
  "ask_location",
  "show_booking_instructions",
  "route_cimel",
  "route_britanico",
  "route_swiss",
  "greeting_existing",
  "thanks_close",
  "human_handoff",
  "human_pending",
  "medical_boundary",
  "possible_emergency",
  "emergency_ambiguous",
  "opt_out_confirmed",
  "opt_out_protocol",
  "unsupported_media",
  "wrong_number_confirmed",
  "caregiver_clarification",
  "ask_clarification",
  "ask_rephrase",
  "coverage_not_verified",
])

export type WhatsAppGlobalAction = z.infer<typeof WhatsAppGlobalActionSchema>
export type WhatsAppResponseKey = z.infer<typeof WhatsAppResponseKeySchema>

export const WhatsAppPolicyStateSchema = z.enum([
  "new",
  "awaiting_consent",
  "awaiting_service",
  "awaiting_coverage",
  "awaiting_location",
  "ready_to_route",
  "routed",
  "handoff_pending",
  "human_active",
  "closed",
  "opted_out",
])

export const WhatsAppPolicyInputTypeSchema = z.enum([
  "text",
  "button",
  "list",
  "audio",
  "image",
  "document",
  "sticker",
  "video",
  "location",
  "contact",
  "unknown",
])

export const WhatsAppPolicyContextSchema = z.object({
  state: WhatsAppPolicyStateSchema,
  input_type: WhatsAppPolicyInputTypeSchema,
  text: z.string().max(4000),
  consecutive_unknown_count: z.number().int().min(0).max(100).default(0),
}).strict()

export type WhatsAppPolicyState = z.infer<typeof WhatsAppPolicyStateSchema>
export type WhatsAppPolicyInputType = z.infer<typeof WhatsAppPolicyInputTypeSchema>
export type WhatsAppPolicyContext = z.input<typeof WhatsAppPolicyContextSchema>

export const WhatsAppPolicyDecisionSchema = z.object({
  policy_version: z.literal(WHATSAPP_POLICY_VERSION),
  source: z.literal("deterministic_policy"),
  nlu: BotNluSchema,
  global_action: WhatsAppGlobalActionSchema,
  response_key: WhatsAppResponseKeySchema,
  handoff: z.boolean(),
  next_state: WhatsAppPolicyStateSchema,
}).strict()

export type WhatsAppPolicyDecision = z.infer<typeof WhatsAppPolicyDecisionSchema>

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const HISTORICAL_OR_NEGATED_PATTERN =
  /\b(?:no tengo dolor|no me falta el aire|no es una urgencia|hace (?:(?:diez|[0-9]+) )?anos|antecedentes? de|semana pasada|antes tenia|antes tuve|no tuve perdida|controle la presion|sin sintomas|lei sobre|ayer ahora esta bien|ya se me paso|no estoy mareado)\b/

const THIRD_PARTY_PATTERN =
  /\b(?:para mi (?:mama|papa|marido|hijo|abuela)|mi abuela|consulto por mi|soy la cuidadora|no es para mi|para otra persona)\b/

const HUMAN_REQUEST_PATTERN =
  /^(?:persona|humano|alguien)$|\b(?:hablar con (?:una persona|alguien|lucia)|prefiero (?:una )?persona|necesito (?:que me atienda alguien|ayuda de un operador|soporte humano)|comunica(?:r|me)? con (?:secretaria|recepcion|el consultorio)|pasame con un asesor|me pueden llamar|llamame|alguien real|no me estas entendiendo|quiero (?:una persona|hablar con|comunicarme con el consultorio))\b/

const OPT_OUT_PATTERN =
  /^(?:baja|stop|unsubscribe)$|\b(?:no me escriban mas|no quiero mas mensajes|dejen de contactarme|no me contacten|no me molesten mas|borrenme de la lista|quiero darme de baja|no autorizo mas comunicaciones)\b/

const APPOINTMENT_SOLVED_PATTERN =
  /\b(?:ya consegui turno|ya saque turno en otro lado|ya me atendi|consegui turno finalmente|ya tengo turno|no necesito mas ya tengo turno)\b/

const THANKS_PATTERN =
  /^(?:gracias|gracias doc|listo gracias|perfecto|joya|buenisimo|dale muchas gracias|chau|hasta luego|ya esta gracias)$/

const GREETING_PATTERN = /^(?:hola|holaa|holis|buenas|buen dia|buenas tardes|buenas noches|hey|hola doc)$/

const CAREGIVER_CURRENT_PATTERN = /\b(?:mi mama|mi papa|mi marido|mi hijo|mi abuela|cuidadora|otra persona)\b/
const NEGATED_SYMPTOM_PATTERN = /\b(?:no tengo|no me falta|no tuve|sin sintomas|yo no tengo|no estoy mareado)\b/
const HISTORICAL_CONTEXT_PATTERN = /\b(?:hace|antecedente|antes|semana pasada|ayer|ya se me paso|lei sobre)\b/

function responseMissingSlots(responseKey: WhatsAppResponseKey): BotNlu["missing_slots"] {
  switch (responseKey) {
    case "consent_request": return ["consent"]
    case "ask_service": return ["service"]
    case "ask_coverage": return ["coverage"]
    case "ask_location": return ["location"]
    case "caregiver_clarification": return ["self_or_third_party"]
    default: return []
  }
}

function nextStateFor(
  current: WhatsAppPolicyState,
  action: WhatsAppGlobalAction,
  responseKey: WhatsAppResponseKey,
  handoff: boolean,
): WhatsAppPolicyState {
  if (action === "opt_out") return "opted_out"
  if (handoff || action === "handoff" || action === "emergency") return "handoff_pending"
  if (responseKey === "ask_service") return "awaiting_service"
  if (responseKey === "ask_coverage") return "awaiting_coverage"
  if (responseKey === "ask_location") return "awaiting_location"
  if (["show_booking_instructions", "route_cimel", "route_britanico", "route_swiss"].includes(responseKey)) {
    return "routed"
  }
  if (responseKey === "thanks_close") return "closed"
  return current
}

type EntityOverrides = Partial<BotNlu["entities"]>

function makeDecision(
  context: z.output<typeof WhatsAppPolicyContextSchema>,
  normalized: string,
  intent: WhatsAppIntentV2,
  responseKey: WhatsAppResponseKey,
  action: WhatsAppGlobalAction = "continue",
  handoff = false,
  entityOverrides: EntityOverrides = {},
  confidence = 0.99,
  ambiguous = false,
): WhatsAppPolicyDecision {
  const emergencySignal = assessEmergencyMessage(context.text)
  const clinicalIntent = [
    "symptom_question",
    "medication_question",
    "test_interpretation",
    "diagnosis_question",
    "treatment_question",
    "post_consultation_clinical_question",
  ].includes(intent)

  const nlu = BotNluSchema.parse({
    schema_version: WHATSAPP_NLU_SCHEMA_VERSION,
    primary_intent: intent,
    secondary_intents: [],
    entities: {
      service: "unknown",
      coverage_name: null,
      payment_mode: "unknown",
      preferred_location: "unknown",
      is_for_self: null,
      ...entityOverrides,
    },
    safety: {
      current_symptoms_possible: emergencySignal !== "none" || clinicalIntent,
      negated_symptoms: NEGATED_SYMPTOM_PATTERN.test(normalized),
      historical_context: HISTORICAL_CONTEXT_PATTERN.test(normalized),
      third_party_context: CAREGIVER_CURRENT_PATTERN.test(normalized),
      emergency_signal: emergencySignal,
    },
    missing_slots: responseMissingSlots(responseKey),
    confidence,
    ambiguous,
  })

  return WhatsAppPolicyDecisionSchema.parse({
    policy_version: WHATSAPP_POLICY_VERSION,
    source: "deterministic_policy",
    nlu,
    global_action: action,
    response_key: responseKey,
    handoff,
    next_state: nextStateFor(context.state, action, responseKey, handoff),
  })
}

function locationFromText(normalized: string): BotNlu["entities"]["preferred_location"] {
  if (/\b(?:cimel|lanus|martes)\b/.test(normalized)) return "cimel_lanus"
  if (/\b(?:britanico|miercoles)\b/.test(normalized)) return "hospital_britanico"
  if (/\b(?:swiss|lomas|viernes)\b/.test(normalized)) return "swiss_lomas"
  return "unknown"
}

function coverageName(normalized: string): string | null {
  if (/\bosde\b/.test(normalized)) return "OSDE"
  if (/\bswiss medical\b/.test(normalized)) return "Swiss Medical"
  if (/\bpami\b/.test(normalized)) return "PAMI"
  return null
}

/**
 * Motor v2 determinístico. No llama modelos, no redacta texto y no tiene
 * efectos externos; por eso puede ejecutarse en shadow mode con seguridad.
 */
export function evaluateWhatsAppPolicy(rawContext: WhatsAppPolicyContext): WhatsAppPolicyDecision {
  const context = WhatsAppPolicyContextSchema.parse(rawContext)
  const normalized = normalize(context.text)

  if (!["text", "button", "list"].includes(context.input_type)) {
    return makeDecision(context, normalized, "unsupported_media", "unsupported_media")
  }

  if (/\bnumero equivocado\b/.test(normalized)) {
    return makeDecision(context, normalized, "wrong_number", "wrong_number_confirmed", "opt_out")
  }

  if (OPT_OUT_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "unknown", "opt_out_confirmed", "opt_out")
  }

  const emergency = assessEmergencyMessage(context.text)
  if (emergency === "strong") {
    return makeDecision(context, normalized, "symptom_question", "possible_emergency", "emergency", true)
  }
  if (emergency === "ambiguous") {
    return makeDecision(context, normalized, "symptom_question", "emergency_ambiguous", "emergency", true, {}, 0.9, true)
  }

  // Una solicitud humana explícita siempre gana; una queja conserva su intent para métricas.
  if (/\bsos inutil\b/.test(normalized) && HUMAN_REQUEST_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "complaint", "human_handoff", "handoff", true)
  }
  if (HUMAN_REQUEST_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "unknown", "human_handoff", "handoff", true)
  }

  // Consultas posteriores a una atención son clínicas y además requieren seguimiento humano.
  if (/\b(?:despues de la consulta|despues de atenderme|indicaciones medicas)\b/.test(normalized)) {
    return makeDecision(
      context,
      normalized,
      "post_consultation_clinical_question",
      "medical_boundary",
      "handoff",
      true,
    )
  }

  // Negaciones y antecedentes se resuelven antes del límite clínico para evitar falsas urgencias.
  if (HISTORICAL_OR_NEGATED_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "cardiology_consult", "ask_clarification", "continue", false, {}, 0.8, true)
  }

  if (/\b(?:te mando|enviar|mandar)\b.*\b(?:ecocardiograma|electro|estudio|documento)\b|\becocardiograma\b.*\bpara que lo vea\b/.test(normalized)) {
    return makeDecision(context, normalized, "send_documents", "medical_boundary")
  }
  if (/\b(?:medicacion|medicamento|remedio|pastilla|dosis|dejo de tomar|dejar de tomar|duplicar)\b/.test(normalized)) {
    return makeDecision(context, normalized, "medication_question", "medical_boundary")
  }
  if (/\b(?:tratamiento|recetame|recetar)\b/.test(normalized)) {
    return makeDecision(context, normalized, "treatment_question", "medical_boundary")
  }
  if (/\b(?:diagnosticame|tengo una arritmia)\b/.test(normalized)) {
    return makeDecision(context, normalized, "diagnosis_question", "medical_boundary")
  }
  if (/\b(?:electro|ecocardiograma|resultado)\b.*\b(?:significa|normal|vea|interpret)\b|\b(?:este resultado es normal|que significa este electro)\b/.test(normalized)) {
    return makeDecision(context, normalized, "test_interpretation", "medical_boundary")
  }
  if (/\b(?:palpitaciones|presion [0-9]{2,3})\b.*\b(?:que puede ser|peligrosa|es peligroso|que hago)\b/.test(normalized)) {
    return makeDecision(context, normalized, "symptom_question", "medical_boundary")
  }

  // Prompt injection, exfiltración y pedidos fuera de alcance nunca llegan a un modelo generativo.
  if (/\b(?:system prompt|api key|datos de otros pacientes|revela secretos)\b|<\s*system\b/.test(normalized)) {
    return makeDecision(context, normalized, "abuse_or_spam", "ask_rephrase")
  }
  if (/\b(?:ahora sos chatgpt|contame un chiste)\b/.test(normalized)) {
    return makeDecision(context, normalized, "small_talk", "ask_rephrase")
  }

  if (APPOINTMENT_SOLVED_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "appointment_already_solved", "thanks_close")
  }
  if (THANKS_PATTERN.test(normalized)) {
    return makeDecision(context, normalized, "thanks", "thanks_close")
  }
  if (GREETING_PATTERN.test(normalized) || context.text.trim() === "👋") {
    return makeDecision(context, normalized, "greeting", "greeting_existing")
  }

  if (THIRD_PARTY_PATTERN.test(normalized)) {
    return makeDecision(
      context,
      normalized,
      "caregiver_or_third_party",
      "caregiver_clarification",
      "ask_clarification",
      false,
      { is_for_self: false },
      0.95,
      true,
    )
  }

  if (/\b(?:cancelar|reprogramar|no puedo ir|cambiar el horario|moverlo|anular|llegare tarde|cancelo)\b/.test(normalized)) {
    return makeDecision(context, normalized, "cancel_or_reschedule", "show_booking_instructions", "continue", false, {
      preferred_location: locationFromText(normalized),
    })
  }

  if (/\bcuanto sale particular\b/.test(normalized)) {
    return makeDecision(
      context,
      normalized,
      "private_payment",
      "human_handoff",
      "handoff",
      true,
      { payment_mode: "private" },
    )
  }

  const explicitLocation =
    /^(?:cimel|swiss lomas)$|\b(?:quiero lanus|prefiero el britanico|donde queda cimel|atienden los viernes|a que hora esta en el britanico|cambiar de sede a lomas)\b/
  if (explicitLocation.test(normalized)) {
    const intent: WhatsAppIntentV2 = /\b(?:viernes|a que hora)\b/.test(normalized)
      ? "opening_days_hours"
      : "location"
    return makeDecision(context, normalized, intent, "show_booking_instructions", "continue", false, {
      preferred_location: locationFromText(normalized),
    })
  }
  if (/^(?:donde atiende|que dias atiende)$/.test(normalized)) {
    const intent: WhatsAppIntentV2 = normalized.includes("dias") ? "opening_days_hours" : "location"
    return makeDecision(context, normalized, intent, "ask_location")
  }

  if (context.state === "awaiting_service") {
    if (/\bprotocolo\b/.test(normalized)) {
      return makeDecision(context, normalized, "research_protocol", "ask_coverage", "continue", false, {
        service: "research_protocol",
      })
    }
    if (/\b(?:consulta|cardiologica)\b.*\b(?:ecocardiograma|eco)\b|\b(?:ecocardiograma|eco)\b.*\bconsulta\b/.test(normalized)) {
      return makeDecision(context, normalized, "both_services", "ask_coverage", "continue", false, {
        service: "both",
      })
    }
    if (/\b(?:ecocardiograma|un eco)\b/.test(normalized)) {
      return makeDecision(context, normalized, "echocardiogram", "ask_coverage", "continue", false, {
        service: "echocardiogram",
      })
    }
    if (/\bcomo saco turno\b/.test(normalized)) {
      return makeDecision(context, normalized, "booking_channel", "ask_coverage")
    }
    if (/\b(?:consulta cardiologica|control con la cardiologa|primera vez|control anual)\b/.test(normalized)) {
      return makeDecision(context, normalized, "cardiology_consult", "ask_coverage", "continue", false, {
        service: "cardiology_consult",
      })
    }
    if (/\b(?:sacar turno|atenderme con la dra|turno para el martes)\b/.test(normalized)) {
      return makeDecision(context, normalized, "request_appointment", "ask_coverage")
    }
  }

  if (context.state === "awaiting_coverage") {
    if (/\b(?:duda particular|caso particular)\b/.test(normalized)) {
      return makeDecision(context, normalized, "unknown", "ask_rephrase", "continue", false, {}, 0.25, true)
    }
    if (/\b(?:no tengo obra social|atenderme particular|forma particular|sin cobertura|^particular$)\b/.test(normalized)) {
      return makeDecision(context, normalized, "private_payment", "ask_location", "continue", false, {
        payment_mode: "private",
      })
    }
    if (/\b(?:osde|swiss medical)\b/.test(normalized)) {
      return makeDecision(context, normalized, "insurance_coverage", "ask_location", "continue", false, {
        coverage_name: coverageName(normalized),
        payment_mode: "insurance",
      })
    }
    if (/\bpami\b/.test(normalized)) {
      return makeDecision(context, normalized, "insurance_coverage", "coverage_not_verified", "continue", false, {
        coverage_name: "PAMI",
        payment_mode: "insurance",
      })
    }
    if (/\bcambie de obra social\b/.test(normalized)) {
      return makeDecision(context, normalized, "insurance_coverage", "ask_coverage", "continue", false, {
        payment_mode: "insurance",
      })
    }
  }

  const handoffAfterRepeatedUnknown = context.consecutive_unknown_count >= 1
  if (handoffAfterRepeatedUnknown) {
    return makeDecision(context, normalized, "unknown", "human_handoff", "handoff", true, {}, 0.2, true)
  }
  return makeDecision(context, normalized, "unknown", "ask_rephrase", "continue", false, {}, 0.25, true)
}
