export interface WebsiteJourneyInput {
  visits: number
  activeVisits: number
  bookingOptionsVisits: number
  heroBookingVisits: number
  whatsappVisits: number
  callVisits: number
  bookingVisits: number
  mapsVisits: number
}

export interface WebsiteJourneyStep {
  key: string
  label: string
  sessions: number
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function buildWebsiteJourneySteps(
  input: WebsiteJourneyInput,
  registeredLeads: number,
): WebsiteJourneyStep[] {
  const visits = safeCount(input.visits)
  const activeVisits = Math.min(visits, safeCount(input.activeVisits))

  return [
    { key: "visits", label: "Entraron a la web", sessions: visits },
    { key: "inactive", label: "No hicieron nada más", sessions: visits - activeVisits },
    { key: "booking_options", label: "Llegaron a ver las opciones de sedes", sessions: safeCount(input.bookingOptionsVisits) },
    { key: "hero_booking", label: "Tocaron “Pedir turno” del encabezado", sessions: safeCount(input.heroBookingVisits) },
    { key: "whatsapp", label: "Tocaron WhatsApp", sessions: safeCount(input.whatsappVisits) },
    { key: "call", label: "Tocaron llamar", sessions: safeCount(input.callVisits) },
    { key: "booking", label: "Tocaron turno online", sessions: safeCount(input.bookingVisits) },
    { key: "maps", label: "Tocaron Google Maps", sessions: safeCount(input.mapsVisits) },
    { key: "leads", label: "Consultas registradas", sessions: safeCount(registeredLeads) },
  ]
}

export function websiteJourneyPercentage(sessions: number, visits: number): number {
  const safeVisits = safeCount(visits)
  if (safeVisits === 0) return 0
  return Math.round((safeCount(sessions) / safeVisits) * 1000) / 10
}
