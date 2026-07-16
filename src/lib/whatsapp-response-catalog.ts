import { z } from "zod"
import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY } from "@/lib/medical-safety"
import {
  WhatsAppResponseKeySchema,
  type WhatsAppResponseKey,
} from "@/lib/whatsapp-policy"

export const WHATSAPP_RESPONSE_CATALOG_VERSION = "2026-07-16" as const

const ResponseVariableSchema = z.enum([
  "booking_channel",
  "coverage_name",
  "location_name",
  "privacy_url",
  "team_name",
])

const ResponseTemplateSchema = z.object({
  key: WhatsAppResponseKeySchema,
  version: z.number().int().positive(),
  locale: z.literal("es_AR"),
  channel: z.literal("whatsapp"),
  body: z.string().min(1).max(2000),
  allowedVariables: z.array(ResponseVariableSchema).max(5),
  medicalApprovedAt: z.string().date().optional(),
  legalApprovedAt: z.string().date().optional(),
  active: z.boolean(),
}).strict()

export type WhatsAppResponseTemplate = z.infer<typeof ResponseTemplateSchema>
export type WhatsAppResponseVariable = z.infer<typeof ResponseVariableSchema>

function template(
  key: WhatsAppResponseKey,
  body: string,
  allowedVariables: WhatsAppResponseVariable[] = [],
): WhatsAppResponseTemplate {
  const parsed = ResponseTemplateSchema.parse({
    key,
    version: 1,
    locale: "es_AR",
    channel: "whatsapp",
    body,
    allowedVariables,
    active: true,
  })
  Object.freeze(parsed.allowedVariables)
  return Object.freeze(parsed)
}

/**
 * Única fuente de textos de la política v2. Las dos respuestas clínicas
 * reutilizan literalmente los guardrails determinísticos existentes.
 */
export const WHATSAPP_RESPONSE_CATALOG: Readonly<Record<WhatsAppResponseKey, WhatsAppResponseTemplate>> = Object.freeze({
  consent_request: template(
    "consent_request",
    "Soy el asistente virtual administrativo de la Dra. Lucía Chahin. Para registrar tu consulta y orientarte sobre cómo pedir turno, necesito tu consentimiento. Podés consultar la política de privacidad en {{privacy_url}}.",
    ["privacy_url"],
  ),
  consent_declined: template(
    "consent_declined",
    "Entendido. No voy a registrar tu consulta. Si necesitás atención administrativa, podés comunicarte por los canales oficiales.",
  ),
  ask_service: template(
    "ask_service",
    "¿Necesitás una consulta cardiológica, un ecocardiograma o información sobre un protocolo de investigación?",
  ),
  ask_coverage: template(
    "ask_coverage",
    "¿Tenés obra social o prepaga, o querés atenderte de forma particular?",
  ),
  ask_location: template(
    "ask_location",
    "¿En qué sede preferís atenderte: CIMEL Lanús, Hospital Británico o Swiss Medical Lomas?",
  ),
  show_booking_instructions: template(
    "show_booking_instructions",
    "Para {{location_name}}, solicitá el turno directamente por {{booking_channel}}. Este asistente no confirma disponibilidad ni reserva turnos.",
    ["location_name", "booking_channel"],
  ),
  route_cimel: template(
    "route_cimel",
    "Para CIMEL Lanús, solicitá el turno directamente por {{booking_channel}}. Este asistente no confirma disponibilidad ni reserva turnos.",
    ["booking_channel"],
  ),
  route_britanico: template(
    "route_britanico",
    "Para Hospital Británico, solicitá el turno directamente por {{booking_channel}}. Este asistente no confirma disponibilidad ni reserva turnos.",
    ["booking_channel"],
  ),
  route_swiss: template(
    "route_swiss",
    "Para Swiss Medical Lomas, solicitá el turno directamente por {{booking_channel}}. Este asistente no confirma disponibilidad ni reserva turnos.",
    ["booking_channel"],
  ),
  greeting_existing: template(
    "greeting_existing",
    "¡Hola! Ya tenés cargada tu consulta. ¿Necesitás volver a ver los datos de la sede o hablar con una persona?",
  ),
  thanks_close: template(
    "thanks_close",
    "¡Gracias por escribir! Si necesitás otra orientación administrativa, podés volver a comunicarte.",
  ),
  human_handoff: template(
    "human_handoff",
    "Tu conversación quedó derivada al equipo. El bot permanecerá pausado mientras una persona continúa la atención.",
  ),
  human_pending: template(
    "human_pending",
    "La conversación sigue derivada al equipo y el bot permanece pausado.",
  ),
  medical_boundary: template("medical_boundary", MEDICAL_BOUNDARY_REPLY),
  possible_emergency: template("possible_emergency", EMERGENCY_REPLY),
  emergency_ambiguous: template("emergency_ambiguous", EMERGENCY_REPLY),
  opt_out_confirmed: template(
    "opt_out_confirmed",
    "Listo. Registramos tu pedido y no enviaremos nuevas comunicaciones proactivas a este número.",
  ),
  opt_out_protocol: template(
    "opt_out_protocol",
    "Entendido. No volveremos a contactarte por esta invitación al protocolo.",
  ),
  unsupported_media: template(
    "unsupported_media",
    "Por ahora este asistente no puede revisar audios, imágenes, documentos ni estudios. Escribí tu consulta administrativa en texto. Si necesitás enviar documentación, te derivamos con una persona.",
  ),
  wrong_number_confirmed: template(
    "wrong_number_confirmed",
    "Gracias por avisar. Registramos que es un número equivocado y no enviaremos nuevas comunicaciones proactivas.",
  ),
  caregiver_clarification: template(
    "caregiver_clarification",
    "¿La consulta es para vos o estás ayudando a otra persona? No compartas estudios ni detalles clínicos por este canal administrativo.",
  ),
  ask_clarification: template(
    "ask_clarification",
    "Para orientarte sin evaluar información médica, indicá qué gestión administrativa necesitás: pedir turno, consultar una sede o hablar con una persona.",
  ),
  ask_rephrase: template(
    "ask_rephrase",
    "No pude identificar la gestión administrativa. Podés indicar si necesitás consulta, ecocardiograma, información de una sede o hablar con una persona.",
  ),
  coverage_not_verified: template(
    "coverage_not_verified",
    "La cobertura de {{coverage_name}} debe confirmarse directamente con la institución al pedir el turno; este asistente no puede garantizarla.",
    ["coverage_name"],
  ),
})

export function getApprovedWhatsAppResponse(key: WhatsAppResponseKey): WhatsAppResponseTemplate {
  const response = WHATSAPP_RESPONSE_CATALOG[key]
  if (!response.active) throw new Error(`Inactive WhatsApp response key: ${key}`)
  return response
}

/** Renderiza solo templates aprobados y rechaza variables extra o faltantes. */
export function renderApprovedWhatsAppResponse(
  key: WhatsAppResponseKey,
  variables: Partial<Record<WhatsAppResponseVariable, string>> = {},
): string {
  const response = getApprovedWhatsAppResponse(key)
  const provided = Object.keys(variables) as WhatsAppResponseVariable[]
  const unexpected = provided.find(variable => !response.allowedVariables.includes(variable))
  if (unexpected) throw new Error(`Unexpected variable for ${key}: ${unexpected}`)

  let rendered = response.body
  for (const variable of response.allowedVariables) {
    const marker = `{{${variable}}}`
    if (!rendered.includes(marker)) continue
    const value = variables[variable]?.trim()
    if (!value) throw new Error(`Missing variable for ${key}: ${variable}`)
    if (value.length > 500 || value.includes("{{") || value.includes("}}")) {
      throw new Error(`Invalid variable for ${key}: ${variable}`)
    }
    rendered = rendered.replaceAll(marker, value)
  }

  if (/{{[a-z_]+}}/.test(rendered)) throw new Error(`Unresolved variable for ${key}`)
  return rendered
}
