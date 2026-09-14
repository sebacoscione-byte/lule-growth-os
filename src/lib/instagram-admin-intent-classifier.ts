import { findPracticeSiteInText, type PracticeServiceId } from "@/lib/practice-directory"

export type InstagramAdministrativeIntent =
  | "pami"
  | "coverage"
  | "appointment_management"
  | "results"
  | "requirements"
  | "contact"
  | "service"
  | "location"
  | "booking"
  | "specialty"

export type InstagramAutoReplyBlockReason =
  | "price"
  | "already_resolved"
  | "explicit_rejection"

export interface InstagramAdministrativeClassification {
  intent: InstagramAdministrativeIntent
  normalizedText: string
  services: PracticeServiceId[]
  confidence: "high" | "medium"
}

const TOKEN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  tmb: "tambien",
  tb: "tambien",
  tamb: "tambien",
  wsp: "whatsapp",
  wapp: "whatsapp",
  whats: "whatsapp",
  tel: "telefono",
  tels: "telefono",
  telefonos: "telefono",
  turnos: "turno",
  citas: "cita",
  consultas: "consulta",
  ecocardio: "ecocardiograma",
  ecocard: "ecocardiograma",
  ecocardios: "ecocardiograma",
  ecocardiogramas: "ecocardiograma",
  ecos: "eco",
  prepagas: "prepaga",
  coberturas: "cobertura",
  resultados: "resultado",
  informes: "informe",
  requisitos: "requisito",
  autorizaciones: "autorizacion",
  documentos: "documentacion",
  direcciones: "direccion",
  horarios: "horario",
  dias: "dia",
  sedes: "sede",
  lugares: "lugar",
  prestaciones: "prestacion",
  servicios: "servicio",
  disponibles: "disponible",
  haces: "hacer",
  hace: "hacer",
  hacen: "hacer",
  realizas: "realizar",
  realiza: "realizar",
  realizan: "realizar",
  atendes: "atender",
  atiendes: "atender",
  atiende: "atender",
  atienden: "atender",
  atenderme: "atender",
  aceptan: "aceptar",
  aceptas: "aceptar",
  necesito: "necesitar",
  necesitas: "necesitar",
  quiero: "querer",
  quieres: "querer",
  quisiera: "querer",
  piden: "pedir",
  pedis: "pedir",
  llevo: "llevar",
  llevaria: "llevar",
  comunico: "comunicar",
  comunicarme: "comunicar",
  llamo: "llamar",
  llamarte: "llamar",
  queda: "quedar",
  quedan: "quedar",
  tenes: "tener",
  tienes: "tener",
  tienen: "tener",
})

// Sólo se corrigen términos administrativos largos y conocidos. El umbral es deliberadamente
// conservador para no convertir texto clínico o una palabra desconocida en una intención segura.
const FUZZY_ADMIN_VOCABULARY = Object.freeze([
  "ecocardiograma",
  "cardiologia",
  "cardiologica",
  "cobertura",
  "prepaga",
  "telefono",
  "whatsapp",
  "direccion",
  "ubicacion",
  "horario",
  "autorizacion",
  "documentacion",
  "resultado",
  "informe",
  "reprogramar",
  "cancelar",
  "confirmar",
  "especialidad",
  "prestacion",
  "disponible",
])

const COVERAGE_BRANDS = Object.freeze([
  "osde",
  "galeno",
  "avalian",
  "medife",
  "medicus",
  "osmecon",
  "ospjn",
  "poder judicial",
  "plan hb",
])

const MANAGEMENT_ACTIONS = Object.freeze([
  "cancelar", "reprogramar", "cambiar", "mover", "modificar", "confirmar", "anular", "pasar",
])
const BOOKING_ACTIONS = Object.freeze([
  "pedir", "sacar", "solicitar", "reservar", "agendar", "conseguir", "necesitar", "querer", "buscar",
])
const SERVICE_ACTIONS = Object.freeze([
  "hacer", "realizar", "ofrecer", "atender", "solo", "tambien", "prestacion", "servicio",
])
const QUESTION_WORDS = Object.freeze(["que", "cual", "cuales", "como", "cuando", "donde", "hay"])
const WEEKDAYS = Object.freeze([
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
])
const PRACTICE_AREAS = Object.freeze(["lanus", "lomas", "caba"])

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost)
      diagonal = above
    }
  }
  return previous[b.length]
}

function fuzzyCanonicalToken(token: string): string {
  const aliased = TOKEN_ALIASES[token]
  if (aliased) return aliased
  if (token.length < 6) return token

  const maxDistance = token.length >= 10 ? 2 : 1
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let tied = false
  for (const candidate of FUZZY_ADMIN_VOCABULARY) {
    if (Math.abs(candidate.length - token.length) > maxDistance) continue
    const distance = levenshtein(token, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
      tied = false
    } else if (distance === bestDistance) {
      tied = true
    }
  }
  return best && bestDistance <= maxDistance && !tied ? best : token
}

export function normalizeInstagramAdministrativeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(fuzzyCanonicalToken)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `)
}

function hasAny(text: string, values: readonly string[]): boolean {
  return values.some(value => hasPhrase(text, value))
}

function tokenCount(text: string): number {
  return text ? text.split(" ").length : 0
}

export function detectInstagramPracticeServices(value: string): PracticeServiceId[] {
  const text = normalizeInstagramAdministrativeText(value)
  const services: PracticeServiceId[] = []
  const echo = hasAny(text, ["ecocardiograma", "eco", "eco cardio"])
  const consultation = hasAny(text, [
    "consulta cardiologica",
    "cardiologia",
    "consultorio",
  ]) || (hasPhrase(text, "consulta") && (echo || hasAny(text, SERVICE_ACTIONS) || Boolean(findPracticeSiteInText(value))))

  if (echo) services.push("echocardiogram")
  if (consultation) services.push("cardiology_consultation")
  return services
}

export function getInstagramAutoReplyBlockReason(value: string): InstagramAutoReplyBlockReason | null {
  const text = normalizeInstagramAdministrativeText(value)
  const hasAppointment = hasAny(text, ["turno", "cita"])

  if (
    hasAny(text, ["precio", "costo", "arancel"]) ||
    hasAny(text, ["cuanto sale", "cuanto cuesta", "cuanto cobra"]) ||
    (hasPhrase(text, "valor") && hasAny(text, ["turno", "consulta", "ecocardiograma", "particular"]))
  ) return "price"

  if (
    hasAppointment && hasAny(text, [
      "ya tengo turno", "ya tenia turno", "ya saque turno", "ya pedi turno", "ya consegui turno", "ya reserve turno",
    ])
  ) return "already_resolved"

  if (
    hasAppointment && hasAny(text, ["no querer turno", "no necesito turno", "no necesitar turno"])
  ) return "explicit_rejection"

  return null
}

function coverageIntent(text: string): boolean {
  const generic = hasAny(text, [
    "obra social", "prepaga", "cobertura", "sin cobertura", "sin obra social", "sin prepaga",
  ])
  const particular = hasPhrase(text, "particular") && hasAny(text, [
    "atender", "atencion", "consulta", "turno", "cita", "pagar", "sin cobertura",
  ])
  const brand = COVERAGE_BRANDS.find(value => hasPhrase(text, value))
  const brandContext = brand && (
    tokenCount(text) <= 3 || hasAny(text, ["atender", "aceptar", "cubrir", "cobertura", "obra social", "prepaga", "tener"])
  )
  return generic || particular || Boolean(brandContext)
}

function appointmentManagementIntent(text: string): boolean {
  return hasAny(text, ["turno", "cita"]) && hasAny(text, MANAGEMENT_ACTIONS)
}

function resultsIntent(text: string): boolean {
  const subject = hasAny(text, ["resultado", "informe"])
  if (!subject) return false
  return hasAny(text, [
    "retirar", "retiro", "buscar", "entregar", "entrega", "disponible", "disponibilidad",
    "descargar", "recibir", "mandar", "enviar", "cuando", "donde", "como",
  ]) || tokenCount(text) <= 4
}

function requirementsIntent(text: string): boolean {
  const adminDocument = hasAny(text, [
    "orden", "autorizacion", "documentacion", "credencial", "dni", "requisito",
  ])
  const adminAction = hasAny(text, [
    "necesitar", "pedir", "hacer falta", "llevar", "presentar", "requisito", "que llevar", "que presentar",
  ])
  if (adminDocument && (adminAction || hasAny(text, QUESTION_WORDS))) return true
  return hasAny(text, ["llevar", "presentar"]) && hasAny(text, ["consulta", "estudio", "turno", "cita"])
}

function contactIntent(text: string): boolean {
  if (hasAny(text, ["telefono", "whatsapp", "contacto", "llamar", "comunicar", "canal de contacto"])) return true
  return hasPhrase(text, "numero") && hasAny(text, ["telefono", "contacto", "llamar", "whatsapp"])
}

function specialtyIntent(text: string): boolean {
  if (hasPhrase(text, "especialidad")) return true
  return hasAny(text, ["es cardiologa", "sos cardiologa", "eres cardiologa", "doctora cardiologa"])
}

function serviceIntent(value: string, text: string, services: PracticeServiceId[]): boolean {
  const siteMentioned = Boolean(findPracticeSiteInText(value))
  const genericService = hasAny(text, ["prestacion", "servicio"])
  const asksWhat = hasAny(text, ["que hacer", "que servicio", "que prestacion"])
  if (genericService && (hasAny(text, QUESTION_WORDS) || siteMentioned)) return true
  if (services.length === 0) return asksWhat && siteMentioned
  return siteMentioned || hasAny(text, SERVICE_ACTIONS) || hasAny(text, ["donde", "hay", "solo", "tambien"]) || tokenCount(text) <= 4
}

function locationIntent(value: string, text: string): boolean {
  const siteMentioned = Boolean(findPracticeSiteInText(value))
  if (hasAny(text, ["direccion", "ubicacion", "como llegar", "donde quedar", "donde atender"])) return true
  if (hasPhrase(text, "donde") && hasAny(text, ["atender", "consultorio", "sede", "lugar", "doctora"])) return true
  if (hasPhrase(text, "atender") && hasAny(text, PRACTICE_AREAS)) return true

  const schedule = hasAny(text, ["horario", "que dia", "cuando", ...WEEKDAYS])
  if (schedule && (siteMentioned || hasAny(text, ["atender", "sede", "consultorio", "doctora"]))) return true
  return siteMentioned && hasAny(text, ["direccion", "horario", "dia", "quedar"])
}

function bookingIntent(text: string): boolean {
  const appointment = hasAny(text, ["turno", "cita"])
  const consultation = hasPhrase(text, "consulta")
  const availability = hasAny(text, ["disponible", "disponibilidad", "hay turno", "hay cita"])
  const asksIfAvailable = appointment && hasAny(text, ["hay", "tener"])
  if (appointment && (hasAny(text, BOOKING_ACTIONS) || availability || asksIfAvailable || tokenCount(text) <= 3)) return true
  if (consultation && hasAny(text, BOOKING_ACTIONS)) return true
  return false
}

/**
 * Clasificador administrativo cerrado, sin LLM y sin texto libre. Primero normaliza abreviaturas y
 * errores tipográficos conservadores y después clasifica por señales semánticas compuestas. La
 * respuesta visible se sigue construyendo desde plantillas fijas en instagram-booking-auto-reply.ts.
 */
export function classifyInstagramAdministrativeIntent(value: string): InstagramAdministrativeClassification | null {
  const normalizedText = normalizeInstagramAdministrativeText(value)
  if (!normalizedText) return null
  const services = detectInstagramPracticeServices(value)

  if (hasPhrase(normalizedText, "pami")) {
    return { intent: "pami", normalizedText, services, confidence: "high" }
  }
  if (coverageIntent(normalizedText)) {
    return { intent: "coverage", normalizedText, services, confidence: "high" }
  }
  if (appointmentManagementIntent(normalizedText)) {
    return { intent: "appointment_management", normalizedText, services, confidence: "high" }
  }
  if (resultsIntent(normalizedText)) {
    return { intent: "results", normalizedText, services, confidence: "high" }
  }
  if (requirementsIntent(normalizedText)) {
    return { intent: "requirements", normalizedText, services, confidence: "high" }
  }
  if (contactIntent(normalizedText)) {
    return { intent: "contact", normalizedText, services, confidence: "high" }
  }
  if (specialtyIntent(normalizedText)) {
    return { intent: "specialty", normalizedText, services, confidence: "high" }
  }
  if (serviceIntent(value, normalizedText, services)) {
    return { intent: "service", normalizedText, services, confidence: services.length > 0 ? "high" : "medium" }
  }
  if (locationIntent(value, normalizedText)) {
    return { intent: "location", normalizedText, services, confidence: "high" }
  }
  if (bookingIntent(normalizedText)) {
    return { intent: "booking", normalizedText, services, confidence: "high" }
  }
  return null
}
