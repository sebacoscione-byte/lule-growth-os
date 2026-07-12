import { z } from "zod"

// Enums exactos de src/types/index.ts — un valor fuera de estos rompe los labels/lookups que
// asumen el tipo en cualquier pantalla (CRM, dashboard, export). Compartido entre POST /api/leads
// y PATCH /api/leads/[id] (SEC-01) para no duplicar la lista si se agrega un estado/canal nuevo.
const leadStatusEnum = z.enum([
  "nuevo", "interesado", "calificado", "derivado_cimel", "derivado_swiss", "derivado_britanico",
  "seguimiento_pendiente", "confirmo_que_pidio_turno", "no_pudo_pedir_turno", "requiere_humano",
  "urgencia_derivada", "descartado", "spam", "elegible_protocolo",
])

const originChannelEnum = z.enum([
  "google_maps", "google_search", "instagram", "whatsapp", "manual", "referral", "landing_page",
])

const requestedServiceEnum = z.enum(["consulta_cardiologia", "ecocardiograma", "no_definido"])

const preferredLocationEnum = z.enum(["cimel_lanus", "swiss_lomas", "hospital_britanico", "sin_definir"])

const preferredDayEnum = z.enum(["martes", "viernes", "miercoles", "sin_definir"])

const shortText = (max: number) => z.string().trim().max(max).nullable().optional()

export const leadFieldsSchema = z.object({
  name: shortText(200),
  phone: shortText(40),
  instagram_username: shortText(100),
  origin_channel: originChannelEnum.optional(),
  origin_campaign: shortText(200),
  searched_keyword: shortText(200),
  insurance: shortText(200),
  general_reason: shortText(2000),
  consent_to_contact: z.boolean().optional(),
  requested_service: requestedServiceEnum.optional(),
  preferred_location: preferredLocationEnum.optional(),
  preferred_day: preferredDayEnum.optional(),
  status: leadStatusEnum.optional(),
  priority_score: z.number().int().min(0).max(10).optional(),
  requires_human: z.boolean().optional(),
  possible_emergency: z.boolean().optional(),
  confirmed_booked: z.boolean().optional(),
  ai_summary: shortText(5000),
  last_message: shortText(5000),
  followup_due_at: shortText(40),
  referred_at: shortText(40),
  utm_source: shortText(200),
  utm_medium: shortText(200),
  utm_campaign: shortText(200),
  utm_content: shortText(200),
  origin_url: shortText(2000),
  landing_page: shortText(200),
  clicked_cimel_cta: z.boolean().optional(),
  clicked_swiss_cta: z.boolean().optional(),
  clicked_britanico_cta: z.boolean().optional(),
  booking_instruction_viewed: z.boolean().optional(),
})
