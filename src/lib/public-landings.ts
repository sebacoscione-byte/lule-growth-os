export interface PublicLandingLocation {
  name: string
  address?: string
  day: string
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

const CIMEL = {
  name: "CIMEL Lanús",
  address: "Tucumán 1314, Lanús",
  day: "Martes",
  phone: "011 4249-3412",
  mapsUrl: "https://share.google/rsph8WtMpJAiRkeki",
}

const SWISS = {
  name: "Swiss Medical Lomas",
  address: "Oliden 141, Lomas de Zamora",
  day: "Viernes",
  phone: "0810-333-8876",
  mapsUrl: "https://maps.app.goo.gl/tzSVjSYm47UfNkLJ8",
}

const BRITANICO = {
  name: "Hospital Británico (Central)",
  address: "Perdriel 74, CABA",
  day: "Miércoles",
  phone: "4309-6400",
  mapsUrl: "https://maps.app.goo.gl/ZPbUhv7PAtUnS6D79",
}

export const LANDING_DATA: Record<string, PublicLandingData> = {
  "dra-lucia-chahin": {
    title: "Dra. Lucía Chahin — Cardióloga | CIMEL Lanús · Hospital Británico (Central) · Swiss Medical Lomas",
    description: "Dra. Lucía Chahin, médica cardióloga con formación avanzada en ecocardiografía. Residencia de cardiología en el Hospital Británico de Buenos Aires, donde hoy continúa como cardióloga de planta. Atiende en CIMEL Lanús (martes), Hospital Británico (Central) (miércoles) y Swiss Medical Lomas de Zamora (viernes).",
    h1: "Dra. Lucía Chahin — Cardióloga",
    intro: "La Dra. Lucía Chahin es médica cardióloga con formación avanzada en ecocardiografía, formada en el Hospital Británico de Buenos Aires. Atiende consultas cardiológicas y ecocardiogramas en Lanús, en el Hospital Británico (Central) y en Lomas de Zamora.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico", "Evaluación cardiovascular"],
    locations: [
      { ...CIMEL, instruction: "Llamá al 011 4249-3412, solicitá turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
      { ...BRITANICO, instruction: "Llamá al 4309-6400 (atención telefónica 24hs) o a la Central de Turnos 0810-222-2748 / 11-3015-9749, o pedí turno desde la app del Hospital Británico, y solicitá turno con la Dra. Lucía Chahin en cardiología." },
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para cardiología." },
    ],
  },
  "cardiologa-lanus": {
    title: "Cardióloga en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Buscás una cardióloga en Lanús? La Dra. Lucía Belén Chahin atiende los martes en CIMEL Lanús, Tucumán 1314. Consultas cardiológicas y ecocardiogramas.",
    h1: "Cardióloga en Lanús — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús. Realizá consultas cardiológicas y ecocardiogramas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
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
    title: "Ecocardiograma en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Necesitás un ecocardiograma en Lanús? La Dra. Lucía Chahin realiza ecocardiogramas los martes en CIMEL Lanús (Tucumán 1314).",
    h1: "Ecocardiograma en Lanús — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lanús, la Dra. Lucía Chahin lo realiza los martes en CIMEL Lanús.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { ...CIMEL, instruction: "Llamá al 011 4249-3412, pedí turno con la Dra. Lucía Chahin y mencioná que es para ecocardiograma." },
    ],
  },
  "ecocardiograma-lomas": {
    title: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Necesitás un ecocardiograma en Lomas de Zamora? La Dra. Lucía Chahin realiza ecocardiogramas los viernes en Swiss Medical Lomas.",
    h1: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lomas de Zamora, la Dra. Lucía Chahin lo realiza los viernes en Swiss Medical Lomas.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { ...SWISS, instruction: "Llamá a Turnos al 0810-333-8876, escribile a Swity (WhatsApp) o usá la app Mi Swiss Medical, pedí turno con la Dra. Lucía Chahin y mencioná que es para ecocardiograma." },
    ],
  },
  "consulta-cardiologica-lanus": {
    title: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin | CIMEL",
    description: "Consulta cardiológica en Lanús con la Dra. Lucía Chahin. Atiende los martes en CIMEL Lanús, Tucumán 1314.",
    h1: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
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

export const WHATSAPP_MESSAGES = {
  general: "Hola, me gustaría consultar cómo pedir turno con la Dra. Lucía Chahin.",
  cimel: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en CIMEL Lanús (martes). ¿Me pueden ayudar?",
  swiss: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en Swiss Medical Lomas (viernes). ¿Me pueden ayudar?",
  britanico: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en el Hospital Británico (miércoles). ¿Me pueden ayudar?",
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
  "cardiologa-lanus": ["cardiologa-lomas"],
  "cardiologa-lomas": ["cardiologa-lanus"],
  "ecocardiograma-lanus": ["ecocardiograma-lomas"],
  "ecocardiograma-lomas": ["ecocardiograma-lanus"],
  "consulta-cardiologica-lanus": ["consulta-cardiologica-lomas"],
  "consulta-cardiologica-lomas": ["consulta-cardiologica-lanus"],
}
