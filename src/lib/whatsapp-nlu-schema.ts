import { z } from "zod"

/**
 * Contrato cerrado del clasificador de WhatsApp.
 *
 * La salida nunca contiene una respuesta para el paciente: solamente datos
 * estructurados que un motor de política puede validar antes de elegir una
 * clave del catálogo aprobado.
 */
export const WHATSAPP_NLU_SCHEMA_VERSION = "2026-07-16" as const

export const WhatsAppIntentSchema = z.enum([
  "greeting",
  "thanks",
  "goodbye",
  "affirmation",
  "negation",
  "small_talk",
  "complaint",
  "clarification_request",
  "request_appointment",
  "cardiology_consult",
  "echocardiogram",
  "both_services",
  "insurance_coverage",
  "private_payment",
  "location",
  "opening_days_hours",
  "booking_channel",
  "cancel_or_reschedule",
  "appointment_already_solved",
  "followup_status",
  "doctor_information",
  "research_protocol",
  "exam_preparation",
  "send_documents",
  "symptom_question",
  "medication_question",
  "test_interpretation",
  "diagnosis_question",
  "treatment_question",
  "post_consultation_clinical_question",
  "wrong_number",
  "caregiver_or_third_party",
  "unsupported_media",
  "abuse_or_spam",
  "unknown",
])

// Deliberadamente es el mismo enum cerrado; no se acepta `string[]` libre.
export const WhatsAppSecondaryIntentSchema = WhatsAppIntentSchema.exclude(["unknown"])

export const WhatsAppServiceEntitySchema = z.enum([
  "cardiology_consult",
  "echocardiogram",
  "both",
  "research_protocol",
  "unknown",
])

export const WhatsAppLocationEntitySchema = z.enum([
  "cimel_lanus",
  "hospital_britanico",
  "swiss_lomas",
  "unknown",
])

export const WhatsAppMissingSlotSchema = z.enum([
  "consent",
  "service",
  "coverage",
  "location",
  "self_or_third_party",
])

export const BotNluSchema = z.object({
  schema_version: z.literal(WHATSAPP_NLU_SCHEMA_VERSION),
  primary_intent: WhatsAppIntentSchema,
  secondary_intents: z.array(WhatsAppSecondaryIntentSchema).max(4),
  entities: z.object({
    service: WhatsAppServiceEntitySchema,
    coverage_name: z.string().trim().min(1).max(100).nullable(),
    payment_mode: z.enum(["insurance", "private", "unknown"]),
    preferred_location: WhatsAppLocationEntitySchema,
    is_for_self: z.boolean().nullable(),
  }).strict(),
  safety: z.object({
    current_symptoms_possible: z.boolean(),
    negated_symptoms: z.boolean(),
    historical_context: z.boolean(),
    third_party_context: z.boolean(),
    emergency_signal: z.enum(["none", "ambiguous", "strong"]),
  }).strict(),
  missing_slots: z.array(WhatsAppMissingSlotSchema).max(5),
  confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
}).strict()

export type WhatsAppIntentV2 = z.infer<typeof WhatsAppIntentSchema>
export type BotNlu = z.infer<typeof BotNluSchema>

export function parseBotNlu(value: unknown): BotNlu {
  return BotNluSchema.parse(value)
}
