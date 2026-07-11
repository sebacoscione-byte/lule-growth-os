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

/** Objetivo editorial de la pieza: que efecto buscamos, no solo que formato/tema tiene. Alimenta el CTA y el enfoque que le pide el prompt a la IA. */
export type ContentObjective = "alcance" | "educacion" | "confianza" | "conversion"

export const CONTENT_OBJECTIVE_LABELS: Record<ContentObjective, string> = {
  alcance: "Alcance",
  educacion: "Educación",
  confianza: "Confianza",
  conversion: "Conversión",
}

/** Texto de "goal" por defecto segun el objetivo elegido — reemplaza el string fijo que tenia toda pieza antes. */
export const CONTENT_OBJECTIVE_GOALS: Record<ContentObjective, string> = {
  alcance: "Generar alcance y comentarios con una pregunta o un dato que sorprenda",
  educacion: "Dejar un aprendizaje concreto y util para guardar o compartir",
  confianza: "Mostrar cercania y criterio medico para generar confianza",
  conversion: "Captar consultas y explicar como pedir turno",
}

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

/** Un segmento del guion de un reel silencioso: se entiende sin audio, texto en pantalla + direccion de la toma. */
export interface ContentScene {
  from: number
  to: number
  onScreenText: string
  shot: string
}

export interface ContentItem {
  id: string
  topic: string
  category: string
  format: "reel" | "historia" | "carrusel" | "post"
  goal: string
  /** Objetivo elegido al generar la pieza. Piezas viejas (previas a esto) no lo tienen -- tratar como "conversion" al mostrar/filtrar. */
  objective?: ContentObjective
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
  /** Guion del reel silencioso: solo se genera/edita cuando format === "reel". Duracion total sugerida + texto/toma por escena. */
  scenes?: ContentScene[]
  reel_duration_seconds?: number
  visual_url?: string
  source: ContentSource | null
  created_at: string
  updated_at: string
  approved_at: string | null
  auto_publish_result?: Partial<Record<ContentChannel, "published" | "error">>
  /** Estado justo antes de archivar, para poder restaurar a lo que era (no siempre "borrador"). */
  archived_from_status?: ContentStatus
  /** Orden manual dentro de la cola de auto-publicacion de su formato (aprobados). null = todavia no se reordeno a mano, se ordena por approved_at. Se limpia al volver a borrador. */
  queue_rank?: number | null
  /** Contenido "evergreen": si esta seteado, el cron vuelve a publicar esta misma pieza (ya publicada) cada tantos dias desde su ultima publicacion (`updated_at`), en vez de darla por consumida. null/undefined = comportamiento de siempre (se publica una vez y no vuelve a salir). */
  repeat_interval_days?: number | null
  /** Calculado en /api/content/items desde landing_events (utm_content = id) — no se persiste en content_pipeline. */
  tracked_visits?: number
  tracked_interactions?: number
}

export interface AutoPublishTrackSettings {
  enabled: boolean
  times_per_week: number
  /** Dias de la semana elegidos para publicar (0=domingo...6=sabado, igual que Date.getDay()). Como maximo times_per_week dias. Vacio = todavia no se eligio ningun dia, no publica nada aunque este activado. */
  days_of_week: number[]
  /** Cuantas piezas aprobadas publicar juntas en cada corrida (ej. 3 para publicar las 3 sedes de una). Default 1 = comportamiento de siempre. */
  items_per_run: number
  /** Si esta en el futuro, el track no publica nada hasta esa fecha (aunque este activado). null = arrancar ya. */
  starts_at: string | null
  last_published_at: string | null
  last_run_at: string | null
  last_run_result: string | null
}

/** Orden canonico lunes a domingo para mostrar los dias (Date.getDay() empieza en domingo=0). */
export const WEEKDAY_OPTIONS: { day: number; label: string }[] = [
  { day: 1, label: "Lun" },
  { day: 2, label: "Mar" },
  { day: 3, label: "Mié" },
  { day: 4, label: "Jue" },
  { day: 5, label: "Vie" },
  { day: 6, label: "Sáb" },
  { day: 0, label: "Dom" },
]

export interface AutoPublishSettings {
  channels: ContentChannel[]
  post: AutoPublishTrackSettings
  historia: AutoPublishTrackSettings
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
