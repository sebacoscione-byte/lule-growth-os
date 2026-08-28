export const PUBLIC_ANALYTICS_LOCATION_KEYS = [
  "cimel", "swiss", "britanico_lanus", "britanico_central",
] as const
export type PublicAnalyticsLocationKey = typeof PUBLIC_ANALYTICS_LOCATION_KEYS[number]

export interface PublicLandingLocation {
  /** Clave única de UI/SEO. `trackingKey` agrupa sedes de una misma institución. */
  key?: string
  trackingKey?: "cimel" | "swiss" | "britanico"
  /** Clave analítica de la sede física. No se comparte aunque dos sedes usen el mismo canal. */
  analyticsKey?: PublicAnalyticsLocationKey
  name: string
  address?: string
  day: string
  hours?: string
  instruction: string
  phone?: string
  mapsUrl?: string
}

export interface PublicLandingData {
  title: string
  description: string
  h1: string
  intro: string
  services: string[]
  locations: PublicLandingLocation[]
}

type PublicLocationWhatsAppConfig = {
  name: string
  whatsapp?: string | null
}

function normalizedLocationName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
}

/**
 * Hospital Británico usa un único WhatsApp institucional para Central y Lanús. La dirección,
 * el horario, el teléfono y las instrucciones siguen resolviéndose por sede: solamente se
 * comparte este canal de contacto.
 */
export function resolvePublicLocationWhatsApp(
  publicLocationName: string,
  configLocations: PublicLocationWhatsAppConfig[],
  exactLocationWhatsapp?: string | null,
): string | undefined {
  const exact = exactLocationWhatsapp?.trim()
  if (exact) return exact

  const publicName = normalizedLocationName(publicLocationName)
  if (!publicName.includes("hospital britanico")) return undefined

  return configLocations.find(location =>
    normalizedLocationName(location.name).includes("hospital britanico")
    && Boolean(location.whatsapp?.trim())
  )?.whatsapp?.trim()
}

const CIMEL = {
  key: "cimel",
  trackingKey: "cimel" as const,
  analyticsKey: "cimel" as const,
  name: "CIMEL Lanús",
  address: "Tucumán 1314, Lanús",
  day: "martes, jueves y viernes",
  hours: "Martes 13:00–15:00\nJueves y viernes 13:00–16:00",
  phone: "011 4249-3412",
  mapsUrl: "https://share.google/rsph8WtMpJAiRkeki",
}

const SWISS = {
  key: "swiss",
  trackingKey: "swiss" as const,
  analyticsKey: "swiss" as const,
  name: "Swiss Medical Lomas",
  address: "Oliden 141, Lomas de Zamora",
  day: "viernes",
  hours: "Viernes 17:00–20:00",
  phone: "0810-333-8876",
  mapsUrl: "https://maps.app.goo.gl/tzSVjSYm47UfNkLJ8",
}

const BRITANICO_CENTRAL = {
  key: "britanico-central",
  trackingKey: "britanico" as const,
  analyticsKey: "britanico_central" as const,
  name: "Hospital Británico (Central)",
  address: "Perdriel 74, CABA",
  day: "miércoles",
  hours: "Miércoles 17:00–19:45",
  phone: "4309-6400",
  mapsUrl: "https://maps.app.goo.gl/ZPbUhv7PAtUnS6D79",
}

const BRITANICO_LANUS = {
  key: "britanico-lanus",
  trackingKey: "britanico" as const,
  analyticsKey: "britanico_lanus" as const,
  name: "Hospital Británico Lanús",
  address: "Av. Hipólito Yrigoyen 4429, Lanús",
  day: "martes",
  hours: "Martes 16:00–19:30 · Ecocardiogramas",
  phone: "0810-222-2748",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Hospital%20Brit%C3%A1nico%20Lan%C3%BAs%20Av.%20Hip%C3%B3lito%20Yrigoyen%204429",
}

const BRITANICO_INSTRUCTION = "Llamá a la Central de Turnos 0810-222-2748 o al 4309-6400, o pedí turno desde la app del Hospital Británico, y solicitá turno con la Dra. Lucía Chahin indicando la sede."

export const LANDING_DATA: Record<string, PublicLandingData> = {
  "dra-lucia-chahin": {
    title: "Dra. Lucía Chahin — Cardióloga | Lanús · CABA · Lomas de Zamora",
    description: "Dra. Lucía Chahin, médica cardióloga y ecocardiografista. Atiende en CIMEL Lanús los martes, jueves y viernes; realiza ecocardiogramas en Hospital Británico Lanús los martes; atiende en Hospital Británico Central los miércoles y en Swiss Medical Lomas los viernes.",
    h1: "Dra. Lucía Chahin — Cardióloga",
    intro: "La Dra. Lucía Chahin es médica cardióloga con formación avanzada en ecocardiografía, formada en el Hospital Británico de Buenos Aires. Atiende en CIMEL Lanús, Hospital Británico Lanús y Central, y Swiss Medical Lomas de Zamora.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico", "Evaluación cardiovascular"],
    locations: [
      { ...CIMEL, instruction: "Llamá al 011 4249-3412, solicitá turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
      { ...BRITANICO_LANUS, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para ecocardiograma en Hospital Británico Lanús.` },
      { ...BRITANICO_CENTRAL, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para cardiología en Hospital Británico Central.` },
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
    ],
  },
  "cardiologa-lanus": {
    title: "Cardióloga en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Buscás una cardióloga en Lanús? La Dra. Lucía Belén Chahin atiende los martes, jueves y viernes en CIMEL Lanús, Tucumán 1314. Consultas cardiológicas y controles.",
    h1: "Cardióloga en Lanús — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lanús, la Dra. Lucía Chahin atiende los martes, jueves y viernes en CIMEL Lanús.",
    services: ["Consulta cardiológica", "Control cardiológico", "Evaluación cardiovascular"],
    locations: [
      { ...CIMEL, instruction: "Llamá al 011 4249-3412, pedí turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
    ],
  },
  "cardiologa-lomas": {
    title: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Buscás una cardióloga en Lomas de Zamora? La Dra. Lucía Belén Chahin atiende los viernes en Swiss Medical Lomas de Zamora. Consultas cardiológicas y ecocardiogramas.",
    h1: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
    ],
  },
  "ecocardiograma-lanus": {
    title: "Ecocardiograma en Lanús — Dra. Lucía Chahin | Hospital Británico",
    description: "¿Necesitás un ecocardiograma en Lanús? La Dra. Lucía Chahin realiza ecocardiogramas los martes de 16:00 a 19:30 en Hospital Británico Lanús, Av. Hipólito Yrigoyen 4429.",
    h1: "Ecocardiograma en Lanús — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lanús, la Dra. Lucía Chahin lo realiza los martes en Hospital Británico Lanús.",
    services: ["Ecocardiograma"],
    locations: [
      { ...BRITANICO_LANUS, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para ecocardiograma en Hospital Británico Lanús.` },
    ],
  },
  "ecocardiograma-lomas": {
    title: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Necesitás un ecocardiograma en Lomas de Zamora? La Dra. Lucía Chahin realiza ecocardiogramas los viernes en Swiss Medical Lomas.",
    h1: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lomas de Zamora, la Dra. Lucía Chahin lo realiza los viernes en Swiss Medical Lomas, Oliden 141. Podés pedir turno por la app Mi Swiss Medical, por WhatsApp con Swity o por la central telefónica de la institución.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para ecocardiograma." },
    ],
  },
  "consulta-cardiologica-lanus": {
    title: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin | CIMEL",
    description: "Consulta cardiológica en Lanús con la Dra. Lucía Chahin. Atiende los martes, jueves y viernes en CIMEL Lanús, Tucumán 1314.",
    h1: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lanús, la Dra. Lucía Chahin atiende los martes, jueves y viernes en CIMEL Lanús.",
    services: ["Consulta cardiológica", "Control cardiovascular"],
    locations: [
      { ...CIMEL, instruction: "Llamá al 011 4249-3412, pedí turno con la Dra. Lucía Chahin y mencioná que es para consulta de cardiología." },
    ],
  },
  "consulta-cardiologica-lomas": {
    title: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "Consulta cardiológica en Lomas de Zamora con la Dra. Lucía Chahin. Atiende los viernes en Swiss Medical Lomas.",
    h1: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para consulta de cardiología." },
    ],
  },
  "cardiologa-caba": {
    title: "Cardióloga en CABA — Dra. Lucía Chahin | Hospital Británico",
    description: "¿Buscás una cardióloga en CABA? La Dra. Lucía Chahin atiende los miércoles en el Hospital Británico (Perdriel 74), donde hizo su residencia y hoy continúa como cardióloga de planta. Consultas cardiológicas y ecocardiogramas.",
    h1: "Cardióloga en CABA — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en CABA, la Dra. Lucía Chahin atiende los miércoles en el Hospital Británico (Central), donde se formó como residente de cardiología y hoy continúa como cardióloga de planta. Realizá consultas cardiológicas y ecocardiogramas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { ...BRITANICO_CENTRAL, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para cardiología en Hospital Británico Central.` },
    ],
  },
  "ecocardiograma-caba": {
    title: "Ecocardiograma en CABA — Dra. Lucía Chahin | Hospital Británico",
    description: "¿Necesitás un ecocardiograma en CABA? La Dra. Lucía Chahin realiza ecocardiogramas los miércoles en el Hospital Británico (Central), Perdriel 74.",
    h1: "Ecocardiograma en CABA — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en CABA, la Dra. Lucía Chahin lo realiza los miércoles en el Hospital Británico (Central).",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { ...BRITANICO_CENTRAL, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para ecocardiograma en Hospital Británico Central.` },
    ],
  },
  "consulta-cardiologica-caba": {
    title: "Consulta Cardiológica en CABA — Dra. Lucía Chahin | Hospital Británico",
    description: "Consulta cardiológica en CABA con la Dra. Lucía Chahin. Atiende los miércoles en el Hospital Británico (Central), Perdriel 74.",
    h1: "Consulta Cardiológica en CABA — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en CABA, la Dra. Lucía Chahin atiende los miércoles en el Hospital Británico (Central).",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { ...BRITANICO_CENTRAL, instruction: `${BRITANICO_INSTRUCTION} Mencioná que es para consulta de cardiología en Hospital Británico Central.` },
    ],
  },
}

export const PUBLIC_LANDING_SLUGS = Object.keys(LANDING_DATA)

export const WHATSAPP_NUMBER = "5491178285006"

// Normaliza un teléfono argentino cargado en Configuración (ej: "11 5051-9982") al
// formato que espera wa.me (54 + 9 + característica + número, sin 0 ni 15).
function normalizeArWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0/, "")
  return digits.startsWith("54") ? digits : `549${digits}`
}

// `rawNumber` permite usar el WhatsApp propio de una sede (ej: Swity de Swiss Medical)
// en vez del WhatsApp del consultorio, cuando la institución atiende consultas ahí.
export function buildWhatsAppUrl(message: string, rawNumber?: string): string {
  const number = rawNumber ? normalizeArWhatsAppNumber(rawNumber) : WHATSAPP_NUMBER
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

// GROWTH-01: un código de referencia (ver landing-referral-codes.ts) solo sirve si el mensaje
// realmente llega al número del bot (src/lib/whatsapp-bot.ts) — a cualquier otro número (ej.
// Swity de Swiss Medical) nunca lo vamos a poder leer. Compara el número ya resuelto, no solo si
// hay un override cargado, por si alguna vez el override coincidiera con el número del bot.
export function resolvesToBotNumber(rawNumber?: string): boolean {
  const number = rawNumber ? normalizeArWhatsAppNumber(rawNumber) : WHATSAPP_NUMBER
  return number === WHATSAPP_NUMBER
}

export const WHATSAPP_MESSAGES = {
  general: "Hola, me gustaría consultar cómo pedir turno con la Dra. Lucía Chahin.",
  cimel: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en CIMEL Lanús (martes, jueves o viernes). ¿Me pueden ayudar?",
  swiss: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en Swiss Medical Lomas (viernes). ¿Me pueden ayudar?",
  britanico: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en el Hospital Británico. ¿Me pueden ayudar?",
}

// Microcopy por servicio: ayuda al paciente a autoidentificarse antes de pedir turno.
export const SERVICE_MICROCOPY: Record<string, string> = {
  "Consulta cardiológica": "Evaluación inicial o de seguimiento para síntomas como palpitaciones, presión alta, dolor en el pecho o controles preventivos.",
  "Ecocardiograma": "Estudio por imágenes para evaluar la estructura y función del corazón. Ideal si te lo indicó tu médico o necesitás control cardiológico.",
  "Control cardiológico": "Seguimiento periódico de factores de riesgo, tratamiento y evolución clínica.",
  "Evaluación cardiovascular": "Chequeo integral del riesgo cardiovascular, útil antes de una cirugía o para prevención.",
  "Control cardiovascular": "Seguimiento periódico de factores de riesgo, tratamiento y evolución clínica.",
}

// Determina la key de mensaje de WhatsApp (y de evento de tracking) según el nombre de la sede.
export function whatsAppKeyForLocation(name: string): keyof typeof WHATSAPP_MESSAGES {
  const lower = name.toLowerCase()
  if (lower.includes("cimel")) return "cimel"
  if (lower.includes("swiss")) return "swiss"
  if (lower.includes("británico") || lower.includes("britanico")) return "britanico"
  return "general"
}

// Enlazado interno entre landings SEO hermanas (mismo servicio, otra sede) — mejora crawling y UX.
export const RELATED_LANDING_SLUGS: Record<string, string[]> = {
  "cardiologa-lanus": ["cardiologa-lomas", "cardiologa-caba"],
  "cardiologa-lomas": ["cardiologa-lanus", "cardiologa-caba"],
  "cardiologa-caba": ["cardiologa-lanus", "cardiologa-lomas"],
  "ecocardiograma-lanus": ["ecocardiograma-lomas", "ecocardiograma-caba"],
  "ecocardiograma-lomas": ["ecocardiograma-lanus", "ecocardiograma-caba"],
  "ecocardiograma-caba": ["ecocardiograma-lanus", "ecocardiograma-lomas"],
  "consulta-cardiologica-lanus": ["consulta-cardiologica-lomas", "consulta-cardiologica-caba"],
  "consulta-cardiologica-lomas": ["consulta-cardiologica-lanus", "consulta-cardiologica-caba"],
  "consulta-cardiologica-caba": ["consulta-cardiologica-lanus", "consulta-cardiologica-lomas"],
}
