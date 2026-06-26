export interface PublicLandingLocation {
  name: string
  address?: string
  day: string
  instruction: string
}

export interface PublicLandingData {
  title: string
  description: string
  h1: string
  intro: string
  services: string[]
  locations: PublicLandingLocation[]
}

export const LANDING_DATA: Record<string, PublicLandingData> = {
  "dra-lucia-chahin": {
    title: "Dra. Lucía Chahin — Cardióloga | CIMEL Lanús · Swiss Medical Lomas",
    description: "La Dra. Lucía Chahin es médica cardióloga. Atiende consultas de cardiología y realiza ecocardiogramas en CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).",
    h1: "Dra. Lucía Chahin — Cardióloga",
    intro: "La Dra. Lucía Chahin es médica cardióloga especializada en consultas cardiológicas y ecocardiogramas. Atiende en Lanús y Lomas de Zamora.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico", "Evaluación cardiovascular"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Comunicate con CIMEL Lanús y pedí turno con la Dra. Lucía Chahin." },
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
  "cardiologa-lanus": {
    title: "Cardióloga en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Buscás una cardióloga en Lanús? La Dra. Lucía Chahin atiende consultas de cardiología los martes en CIMEL Lanús (Tucumán 1314).",
    h1: "Cardióloga en Lanús — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús. Realizá consultas cardiológicas y ecocardiogramas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para cardiología." },
    ],
  },
  "cardiologa-lomas": {
    title: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Buscás una cardióloga en Lomas de Zamora? La Dra. Lucía Chahin atiende consultas de cardiología los viernes en Swiss Medical Lomas.",
    h1: "Cardióloga en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si buscás una cardióloga en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiológico"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
  "ecocardiograma-lanus": {
    title: "Ecocardiograma en Lanús — Dra. Lucía Chahin | CIMEL Lanús",
    description: "¿Necesitás un ecocardiograma en Lanús? La Dra. Lucía Chahin realiza ecocardiogramas los martes en CIMEL Lanús (Tucumán 1314).",
    h1: "Ecocardiograma en Lanús — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lanús, la Dra. Lucía Chahin lo realiza los martes en CIMEL Lanús.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para ecocardiograma." },
    ],
  },
  "ecocardiograma-lomas": {
    title: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "¿Necesitás un ecocardiograma en Lomas de Zamora? La Dra. Lucía Chahin realiza ecocardiogramas los viernes en Swiss Medical Lomas.",
    h1: "Ecocardiograma en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Si necesitás un ecocardiograma en Lomas de Zamora, la Dra. Lucía Chahin lo realiza los viernes en Swiss Medical Lomas.",
    services: ["Ecocardiograma", "Consulta cardiológica"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin para ecocardiograma." },
    ],
  },
  "consulta-cardiologica-lanus": {
    title: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin | CIMEL",
    description: "Consulta cardiológica en Lanús con la Dra. Lucía Chahin. Atiende los martes en CIMEL Lanús, Tucumán 1314.",
    h1: "Consulta Cardiológica en Lanús — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lanús, la Dra. Lucía Chahin atiende los martes en CIMEL Lanús.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { name: "CIMEL Lanús", address: "Tucumán 1314, Lanús", day: "Martes", instruction: "Llamá a CIMEL Lanús y pedí turno con la Dra. Lucía Chahin para consulta de cardiología." },
    ],
  },
  "consulta-cardiologica-lomas": {
    title: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin | Swiss Medical",
    description: "Consulta cardiológica en Lomas de Zamora con la Dra. Lucía Chahin. Atiende los viernes en Swiss Medical Lomas.",
    h1: "Consulta Cardiológica en Lomas de Zamora — Dra. Lucía Chahin",
    intro: "Para una consulta cardiológica en Lomas de Zamora, la Dra. Lucía Chahin atiende los viernes en Swiss Medical Lomas.",
    services: ["Consulta cardiológica", "Ecocardiograma", "Control cardiovascular"],
    locations: [
      { name: "Swiss Medical Lomas", day: "Viernes", instruction: "Pedí turno por los canales oficiales de Swiss Medical Lomas y solicitá atención con la Dra. Lucía Chahin." },
    ],
  },
}

export const PUBLIC_LANDING_SLUGS = Object.keys(LANDING_DATA)

export const WHATSAPP_NUMBER = "5491123842117"

export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`
}

export const WHATSAPP_MESSAGES = {
  general: "Hola, me gustaría consultar cómo pedir turno con la Dra. Lucía Chahin.",
  cimel: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en CIMEL Lanús (martes). ¿Me pueden ayudar?",
  swiss: "Hola, me gustaría pedir turno con la Dra. Lucía Chahin en Swiss Medical Lomas (viernes). ¿Me pueden ayudar?",
}
