export type LeadStatus =
  | "nuevo"
  | "interesado"
  | "calificado"
  | "derivado_cimel"
  | "derivado_swiss"
  | "derivado_britanico"
  | "seguimiento_pendiente"
  | "confirmo_que_pidio_turno"
  | "no_pudo_pedir_turno"
  | "requiere_humano"
  | "urgencia_derivada"
  | "descartado"
  | "spam"
  | "elegible_protocolo"

export type OriginChannel =
  | "google_maps"
  | "google_search"
  | "instagram"
  | "whatsapp"
  | "manual"
  | "referral"
  | "landing_page"

export type RequestedService =
  | "consulta_cardiologia"
  | "ecocardiograma"
  | "no_definido"

export type PreferredLocation =
  | "cimel_lanus"
  | "swiss_lomas"
  | "hospital_britanico"
  | "sin_definir"

export type LeadIntent =
  | "turno"
  | "consulta_cardiologia"
  | "ecocardiograma"
  | "cobertura"
  | "lugar_atencion"
  | "consulta_medica"
  | "urgencia"
  | "spam"
  | "otro"

export type NextAction =
  | "responder"
  | "pedir_preferencia"
  | "derivar_cimel"
  | "derivar_swiss"
  | "derivar_britanico"
  | "escalar"
  | "descartar"

export interface Lead {
  id: string
  name: string | null
  phone: string | null
  instagram_username: string | null
  origin_channel: OriginChannel
  origin_campaign: string | null
  searched_keyword: string | null
  requested_service: RequestedService
  preferred_location: PreferredLocation
  preferred_day: "martes" | "viernes" | "miercoles" | "sin_definir"
  insurance: string | null
  general_reason: string | null
  consent_to_contact: boolean
  status: LeadStatus
  priority_score: number
  possible_emergency: boolean
  requires_human: boolean
  ai_summary: string | null
  last_message: string | null
  created_at: string
  updated_at: string
  referred_at: string | null
  followup_due_at: string | null
  confirmed_booked: boolean
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  origin_url: string | null
  landing_page: string | null
  clicked_cimel_cta: boolean
  clicked_swiss_cta: boolean
  clicked_britanico_cta: boolean
  booking_instruction_viewed: boolean
  protocol_interest: boolean
  protocol_opt_out: boolean
  protocol_name: string | null
  patient_age: number | null
  prior_studies_or_symptoms: string | null
}

export interface Message {
  id: string
  lead_id: string
  role: "user" | "assistant"
  content: string
  created_at: string
}

export interface GrowthExperiment {
  id: string
  name: string
  channel: "google_maps" | "seo" | "instagram" | "google_ads" | "whatsapp" | "referrals"
  hypothesis: string
  content_or_action: string
  start_date: string
  end_date: string | null
  metric_to_improve: string
  result: string | null
  winner: boolean | null
  created_at: string
}

export type ContentStatus = "draft" | "approved" | "published" | "archived"
export type ContentChannel = "instagram" | "google_business"

export interface ContentSource {
  title: string
  url: string
  publication: string
  published_at: string
  summary: string
}

export interface ContentSlide {
  headline: string
  text: string
}

export interface ContentItem {
  id: string
  topic: string
  category: string
  format: "reel" | "historia" | "carrusel" | "post"
  goal: string
  status: ContentStatus
  channels: ContentChannel[]
  hook: string
  caption: string
  google_text: string
  hashtags: string
  visual_headline: string
  visual_subtitle: string
  visual_style: "rose" | "blue" | "teal"
  image_prompt?: string
  image_alt_text?: string
  slides?: ContentSlide[]
  source: ContentSource | null
  created_at: string
  updated_at: string
  approved_at: string | null
}

export interface ClassifyResult {
  intent: LeadIntent
  requested_service: RequestedService
  suggested_location: PreferredLocation | "preguntar"
  suggested_day: "martes" | "viernes" | "miercoles" | "preguntar"
  priority_score: number
  requires_human: boolean
  possible_emergency: boolean
  reply_suggestion: string
  next_action: NextAction
}

// ── WhatsApp: costos, ventana de 24h, intents, templates ────

export type WhatsAppCategory = "marketing" | "utility" | "authentication" | "service"
export type WhatsAppEntryPoint = "organic" | "ctwa" | "referral"
export type WhatsAppWindowState = "open" | "closed"
export type WhatsAppDirection = "inbound" | "outbound"
export type WhatsAppProvider = "cloud_api" | "bsp" | "meta_business_agent"

export interface WhatsAppPricingRule {
  id: string
  country_code: string
  currency: string
  category: WhatsAppCategory
  is_template: boolean
  in_window: boolean
  entry_point: WhatsAppEntryPoint | "any"
  provider: WhatsAppProvider
  cost_amount: number | null
  valid_from: string
  valid_to: string | null
  source_note: string | null
}

export type WhatsAppAiProvider = "sin_ia" | "gemini" | "anthropic" | "openai" | "otro_llm" | "meta_business_agent"

export type WhatsAppIntent =
  | "pedir_turno"
  | "consultar_cobertura"
  | "derivar_protocolo"
  | "ubicacion_horarios"
  | "estudios_cardiologicos"
  | "urgencia_medica"
  | "cancelar_reprogramar"
  | "hablar_con_humano"
  | "otro_no_entendido"

export type TemplateStatus = "borrador" | "pendiente_meta" | "aprobado" | "rechazado"
export type TemplateCategory = "utility" | "marketing"

export interface WhatsAppTemplate {
  id: string
  name: string
  category: TemplateCategory
  language: string
  status: TemplateStatus
  body_text: string
  variables: string[]
  variable_samples: string[]
}

export interface WhatsAppSettings {
  cost_saving_mode: boolean
  enable_service_message_charging: boolean
  warning_message_threshold: number
  handoff_message_threshold: number
  monthly_cost_alert_ars: number | null
  ai_provider: WhatsAppAiProvider
}

export type HandoffReason =
  | "urgencia_medica"
  | "solicitud_explicita"
  | "conversacion_larga"
  | "intent_no_entendido"
  | "sin_template_valido"

export interface DashboardMetrics {
  total_leads: number
  leads_by_channel: Record<OriginChannel, number>
  leads_by_service: Record<RequestedService, number>
  leads_by_location: Record<PreferredLocation, number>
  derivados_cimel: number
  derivados_swiss: number
  derivados_britanico: number
  confirmed_booked: number
  no_pudo_pedir: number
  requires_human: number
  possible_emergencies: number
  weekly_leads: { date: string; count: number }[]
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  nuevo: "Nuevo",
  interesado: "Interesado",
  calificado: "Calificado",
  derivado_cimel: "Derivado CIMEL",
  derivado_swiss: "Derivado Swiss",
  derivado_britanico: "Derivado Británico",
  seguimiento_pendiente: "Seguimiento pendiente",
  confirmo_que_pidio_turno: "Confirmó turno",
  no_pudo_pedir_turno: "No pudo pedir",
  requiere_humano: "Requiere humano",
  urgencia_derivada: "Urgencia derivada",
  descartado: "Descartado",
  spam: "Spam",
  elegible_protocolo: "Elegible para protocolo",
}

export const STATUS_COLORS: Record<LeadStatus, string> = {
  nuevo: "bg-blue-100 text-blue-800",
  interesado: "bg-yellow-100 text-yellow-800",
  calificado: "bg-purple-100 text-purple-800",
  derivado_cimel: "bg-indigo-100 text-indigo-800",
  derivado_swiss: "bg-teal-100 text-teal-800",
  derivado_britanico: "bg-sky-100 text-sky-800",
  seguimiento_pendiente: "bg-orange-100 text-orange-800",
  confirmo_que_pidio_turno: "bg-green-100 text-green-800",
  no_pudo_pedir_turno: "bg-red-100 text-red-800",
  requiere_humano: "bg-pink-100 text-pink-800",
  urgencia_derivada: "bg-red-200 text-red-900",
  descartado: "bg-gray-100 text-gray-600",
  spam: "bg-gray-100 text-gray-400",
  elegible_protocolo: "bg-cyan-100 text-cyan-800",
}

export const CHANNEL_LABELS: Record<OriginChannel, string> = {
  google_maps: "Google Maps",
  google_search: "Google Search",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  manual: "Manual",
  referral: "Referido",
  landing_page: "Landing Page",
}

export const SERVICE_LABELS: Record<RequestedService, string> = {
  consulta_cardiologia: "Consulta cardiológica",
  ecocardiograma: "Ecocardiograma",
  no_definido: "Sin definir",
}

export const LOCATION_LABELS: Record<string, string> = {
  cimel_lanus: "CIMEL Lanús",
  swiss_lomas: "Swiss Medical Lomas",
  hospital_britanico: "Hospital Británico",
  sin_definir: "Sin definir",
  preguntar: "Por definir",
}
