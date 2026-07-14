import { allReferralCodes } from "@/lib/landing-referral-codes"

export interface ReferralEventAggregate {
  slug: string
  location_key: string | null
  event_type: string
  event_count: number | string
}

export interface ReferralLeadAggregate {
  utm_content: string
  confirmed_booked: boolean
}

export interface ReferralDestination {
  code: string
  locationLabel: string
  whatsappClicks: number
  leads: number
  confirmed: number
}

export interface ReferralLandingFunnel {
  landingSlug: string
  specialty: string
  visits: number
  whatsappClicks: number
  leads: number
  confirmed: number
  destinations: ReferralDestination[]
}

const SPECIALTY_LABELS: Record<string, string> = {
  general: "General",
  cardiologia: "Cardiología",
  ecocardiograma: "Ecocardiograma",
  consulta_cardiologica: "Consulta cardiológica",
}

const LOCATION_LABELS: Record<string, string> = {
  cimel: "CIMEL Lanús",
  swiss: "Swiss Medical Lomas",
  britanico: "Hospital Británico",
}

/**
 * Agrupa la atribución por landing. Las visitas pertenecen a la landing, no a cada CTA de sede;
 * por eso se muestran una sola vez y el desglose inferior contiene solamente el avance por sede.
 */
export function buildReferralLandingFunnels(
  events: ReferralEventAggregate[],
  leads: ReferralLeadAggregate[],
): ReferralLandingFunnel[] {
  const visitsBySlug = new Map<string, number>()
  const clicksBySlugLocation = new Map<string, number>()

  for (const row of events) {
    const count = Number(row.event_count)
    if (row.event_type === "page_view") {
      visitsBySlug.set(row.slug, (visitsBySlug.get(row.slug) ?? 0) + count)
    } else if (row.event_type === "click_whatsapp" && row.location_key) {
      clicksBySlugLocation.set(`${row.slug}:${row.location_key}`, count)
    }
  }

  const leadsByCode = new Map<string, { total: number; confirmed: number }>()
  for (const lead of leads) {
    const code = lead.utm_content.toUpperCase()
    const current = leadsByCode.get(code) ?? { total: 0, confirmed: 0 }
    current.total += 1
    if (lead.confirmed_booked) current.confirmed += 1
    leadsByCode.set(code, current)
  }

  const byLanding = new Map<string, ReferralLandingFunnel>()
  for (const info of allReferralCodes().filter(item => item.landingSlug !== "*")) {
    const landing = byLanding.get(info.landingSlug) ?? {
      landingSlug: info.landingSlug,
      specialty: SPECIALTY_LABELS[info.specialty] ?? info.specialty,
      visits: visitsBySlug.get(info.landingSlug) ?? 0,
      whatsappClicks: 0,
      leads: 0,
      confirmed: 0,
      destinations: [],
    }
    const leadTotals = leadsByCode.get(info.code) ?? { total: 0, confirmed: 0 }
    const whatsappClicks = info.locationKey
      ? clicksBySlugLocation.get(`${info.landingSlug}:${info.locationKey}`) ?? 0
      : 0

    landing.whatsappClicks += whatsappClicks
    landing.leads += leadTotals.total
    landing.confirmed += leadTotals.confirmed
    landing.destinations.push({
      code: info.code,
      locationLabel: info.locationKey ? LOCATION_LABELS[info.locationKey] ?? info.locationKey : "General",
      whatsappClicks,
      leads: leadTotals.total,
      confirmed: leadTotals.confirmed,
    })
    byLanding.set(info.landingSlug, landing)
  }

  return [...byLanding.values()].sort((a, b) =>
    b.confirmed - a.confirmed
    || b.leads - a.leads
    || b.whatsappClicks - a.whatsappClicks
    || b.visits - a.visits
  )
}
