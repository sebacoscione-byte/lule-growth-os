// GROWTH-01 (docs/BACKLOG.md): WhatsApp no manda ningún dato del origen de un click al webhook —
// la única forma de saber qué landing/sede generó una conversación es que el propio mensaje
// prellenado lleve una referencia corta. Formato definido por Seba: "Ref: LAN-CARD-01" al final
// del mensaje (visible y editable por el paciente, sin datos personales).
//
// Este registro es la "tabla interna" que relaciona cada código con landing/sede/especialidad —
// vive en código (no en una tabla de Supabase con UI de admin) a propósito, consistente con
// public-landings.ts: agregar una landing ya requiere una PR, así que agregar un código acá es el
// mismo flujo de trabajo, sin sumar una pantalla de administración nueva para un puñado de filas.
export interface ReferralCodeInfo {
  code: string
  landingSlug: string
  /** null = CTA general, no atado a una sede puntual (ver "consultanos por WhatsApp"). */
  locationKey: string | null
  specialty: "general" | "cardiologia" | "ecocardiograma" | "consulta_cardiologica"
  description: string
}

const REFERRAL_CODES: ReferralCodeInfo[] = [
  { code: "LAN-GRAL-01", landingSlug: "dra-lucia-chahin", locationKey: "cimel", specialty: "general", description: "Landing principal, CTA de CIMEL Lanús" },
  { code: "CABA-GRAL-01", landingSlug: "dra-lucia-chahin", locationKey: "britanico", specialty: "general", description: "Landing principal, CTA de Hospital Británico" },
  { code: "LOM-GRAL-01", landingSlug: "dra-lucia-chahin", locationKey: "swiss", specialty: "general", description: "Landing principal, CTA de Swiss Medical Lomas" },
  { code: "LAN-CARD-01", landingSlug: "cardiologa-lanus", locationKey: "cimel", specialty: "cardiologia", description: "Landing 'Cardióloga en Lanús'" },
  { code: "LOM-CARD-01", landingSlug: "cardiologa-lomas", locationKey: "swiss", specialty: "cardiologia", description: "Landing 'Cardióloga en Lomas de Zamora'" },
  { code: "CABA-CARD-01", landingSlug: "cardiologa-caba", locationKey: "britanico", specialty: "cardiologia", description: "Landing 'Cardióloga en CABA'" },
  { code: "LAN-ECO-01", landingSlug: "ecocardiograma-lanus", locationKey: "cimel", specialty: "ecocardiograma", description: "Landing 'Ecocardiograma en Lanús'" },
  { code: "LOM-ECO-01", landingSlug: "ecocardiograma-lomas", locationKey: "swiss", specialty: "ecocardiograma", description: "Landing 'Ecocardiograma en Lomas de Zamora'" },
  { code: "CABA-ECO-01", landingSlug: "ecocardiograma-caba", locationKey: "britanico", specialty: "ecocardiograma", description: "Landing 'Ecocardiograma en CABA'" },
  { code: "LAN-CONS-01", landingSlug: "consulta-cardiologica-lanus", locationKey: "cimel", specialty: "consulta_cardiologica", description: "Landing 'Consulta Cardiológica en Lanús'" },
  { code: "LOM-CONS-01", landingSlug: "consulta-cardiologica-lomas", locationKey: "swiss", specialty: "consulta_cardiologica", description: "Landing 'Consulta Cardiológica en Lomas de Zamora'" },
  { code: "CABA-CONS-01", landingSlug: "consulta-cardiologica-caba", locationKey: "britanico", specialty: "consulta_cardiologica", description: "Landing 'Consulta Cardiológica en CABA'" },
  // CTA de respaldo "consultanos por WhatsApp" (solo aparece si una landing no tiene obras
  // sociales cargadas) — un único código compartido entre todas las landings a propósito: es un
  // link de bajísimo uso, no justifica un código por slug.
  { code: "WEB-GRAL-01", landingSlug: "*", locationKey: null, specialty: "general", description: "CTA de respaldo 'Consultanos por WhatsApp' (cualquier landing)" },
  // Botón "Chatear"/"Usuario de chat" del perfil de Google Business (Google Maps/Búsqueda) — no
  // corresponde a ninguna landing real, pero usa el mismo mecanismo para que esos leads no queden
  // indistinguibles de tráfico orgánico en utm_content/landing_page.
  { code: "MAPS-GRAL-01", landingSlug: "google-maps", locationKey: null, specialty: "general", description: "Botón de chat del perfil de Google Business (Maps/Búsqueda)" },
]

const BY_KEY = new Map(REFERRAL_CODES.map(info => [`${info.landingSlug}:${info.locationKey ?? "general"}`, info]))
const BY_CODE = new Map(REFERRAL_CODES.map(info => [info.code, info]))

export function getReferralCode(landingSlug: string, locationKey: string | null): ReferralCodeInfo | null {
  return BY_KEY.get(`${landingSlug}:${locationKey ?? "general"}`) ?? null
}

export function findReferralCodeInfo(code: string): ReferralCodeInfo | null {
  return BY_CODE.get(code.toUpperCase()) ?? null
}

export function allReferralCodes(): ReferralCodeInfo[] {
  return REFERRAL_CODES
}

// Acepta "Ref: LAN-CARD-01", "ref LAN-CARD-01", etc. — el paciente puede editar mayúsculas o el
// espaciado antes de enviar, así que el match no es estricto en formato, solo en el patrón del
// código (2-4 letras - 2-4 letras - 2 dígitos).
const REF_PATTERN = /ref:?\s*([a-z]{2,4}-[a-z]{2,4}-\d{2})/i

/** Devuelve el código detectado (si lo hay) y el texto sin esa referencia, para no pasarla a intake/IA. */
export function extractReferralCode(text: string): { code: string | null; cleanedText: string } {
  const match = text.match(REF_PATTERN)
  if (!match) return { code: null, cleanedText: text }
  return { code: match[1].toUpperCase(), cleanedText: text.replace(match[0], "").trim() }
}

/** Agrega "Ref: <código>" al final de un mensaje de WhatsApp, si existe un código para esa landing/sede. */
export function withReferralCode(message: string, landingSlug: string, locationKey: string | null): string {
  const info = getReferralCode(landingSlug, locationKey)
  if (!info) return message
  return `${message}\n\nRef: ${info.code}`
}

// CTA de respaldo compartido entre todas las landings (no es slug-específico, ver arriba) —
// se agrega a mano en vez de pasar por getReferralCode/withReferralCode.
export const GENERAL_FALLBACK_CODE = "WEB-GRAL-01"

export function withGeneralFallbackCode(message: string): string {
  return `${message}\n\nRef: ${GENERAL_FALLBACK_CODE}`
}
