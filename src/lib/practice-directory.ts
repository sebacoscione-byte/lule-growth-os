export const PRACTICE_INSTITUTION_IDS = [
  "cimel_lanus",
  "hospital_britanico",
  "swiss_lomas",
] as const

export type PracticeInstitutionId = (typeof PRACTICE_INSTITUTION_IDS)[number]

export const PRACTICE_INSTITUTION_NAMES: Readonly<Record<PracticeInstitutionId, string>> = Object.freeze({
  cimel_lanus: "CIMEL Lanús",
  hospital_britanico: "Hospital Británico",
  swiss_lomas: "Swiss Medical Lomas",
})

export const PRACTICE_SITE_IDS = [
  "cimel_lanus",
  "hospital_britanico_lanus",
  "hospital_britanico_central",
  "swiss_lomas",
] as const

export type PracticeSiteId = (typeof PRACTICE_SITE_IDS)[number]

export interface PracticeSite {
  id: PracticeSiteId
  institutionId: PracticeInstitutionId
  name: string
  address: string
  day: string
  weekdays: readonly string[]
  hours: string
  phone: string
  mapsUrl: string
  serviceNote?: string
}

/**
 * Cronograma asistencial confirmado por la Dra. Lucía Chahin. Es la fuente compartida por las
 * landings y las respuestas administrativas de WhatsApp. La disponibilidad de turnos siempre debe
 * confirmarse con cada institución.
 */
export const PRACTICE_SITES: readonly PracticeSite[] = Object.freeze([
  {
    id: "cimel_lanus",
    institutionId: "cimel_lanus",
    name: "CIMEL Lanús",
    address: "Tucumán 1314, Lanús",
    day: "martes, jueves y viernes",
    weekdays: ["martes", "jueves", "viernes"],
    hours: "Martes 13:00–15:00 · Jueves y viernes 13:00–16:00",
    phone: "011 4249-3412",
    mapsUrl: "https://share.google/rsph8WtMpJAiRkeki",
  },
  {
    id: "hospital_britanico_lanus",
    institutionId: "hospital_britanico",
    name: "Hospital Británico Lanús",
    address: "Av. Hipólito Yrigoyen 4429, Lanús",
    day: "martes",
    weekdays: ["martes"],
    hours: "Martes 16:00–19:30",
    phone: "0810-222-2748",
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=Hospital%20Brit%C3%A1nico%20Lan%C3%BAs%20Av.%20Hip%C3%B3lito%20Yrigoyen%204429",
    serviceNote: "Ecocardiogramas",
  },
  {
    id: "hospital_britanico_central",
    institutionId: "hospital_britanico",
    name: "Hospital Británico Central",
    address: "Perdriel 74, CABA",
    day: "miércoles",
    weekdays: ["miércoles"],
    hours: "Miércoles 17:00–19:45",
    phone: "4309-6400",
    mapsUrl: "https://maps.app.goo.gl/ZPbUhv7PAtUnS6D79",
  },
  {
    id: "swiss_lomas",
    institutionId: "swiss_lomas",
    name: "Swiss Medical Lomas",
    address: "Oliden 141, Lomas de Zamora",
    day: "viernes",
    weekdays: ["viernes"],
    hours: "Viernes 17:00–20:00",
    phone: "0810-333-8876",
    mapsUrl: "https://maps.app.goo.gl/tzSVjSYm47UfNkLJ8",
  },
])

export const PRACTICE_SITE_BY_ID = Object.freeze(Object.fromEntries(
  PRACTICE_SITES.map(site => [site.id, site])
) as Record<PracticeSiteId, PracticeSite>)

export function getPracticeSitesForInstitution(
  institutionId: PracticeInstitutionId
): PracticeSite[] {
  return PRACTICE_SITES.filter(site => site.institutionId === institutionId)
}

export function normalizePracticeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const SITE_ALIASES: Readonly<Record<PracticeSiteId, readonly string[]>> = Object.freeze({
  cimel_lanus: ["cimel", "tucuman 1314"],
  hospital_britanico_lanus: [
    "hospital britanico lanus",
    "hospital britanico de lanus",
    "britanico lanus",
    "britanico de lanus",
    "hb lanus",
    "hipolito yrigoyen 4429",
  ],
  hospital_britanico_central: [
    "hospital britanico central",
    "britanico central",
    "hb central",
    "perdriel 74",
    "britanico caba",
  ],
  swiss_lomas: ["swiss medical lomas", "swiss lomas", "swity", "oliden 141"],
})

export function findPracticeSiteInText(text: string): PracticeSite | null {
  const normalized = normalizePracticeSearch(text)
  if (!normalized) return null

  return PRACTICE_SITES.find(site =>
    SITE_ALIASES[site.id].some(alias => normalized.includes(alias))
  ) ?? null
}

/**
 * Devuelve una institución sólo cuando el texto la identifica sin ambigüedad. Ya no se infiere por
 * "martes" o "viernes": esos días corresponden a más de un lugar en el cronograma actual.
 */
export function findPracticeInstitutionInText(
  text: string,
  allowedInstitutionIds: readonly PracticeInstitutionId[] = PRACTICE_INSTITUTION_IDS
): PracticeInstitutionId | null {
  const allowed = new Set(allowedInstitutionIds)
  const exactSite = findPracticeSiteInText(text)
  if (exactSite && allowed.has(exactSite.institutionId)) return exactSite.institutionId

  const normalized = normalizePracticeSearch(text)
  if (/\bhospital britanico\b|\bbritanico\b/.test(normalized) && allowed.has("hospital_britanico")) {
    return "hospital_britanico"
  }
  if (/\bswiss medical\b|\bswiss\b/.test(normalized) && allowed.has("swiss_lomas")) {
    return "swiss_lomas"
  }
  if (
    /\b(?:prefiero|quiero|sede|atenderme|cambiar)\b.*\blomas\b/.test(normalized)
    && allowed.has("swiss_lomas")
  ) {
    return "swiss_lomas"
  }

  const institutionsForMentionedDay = PRACTICE_SITES
    .filter(site => site.weekdays.map(normalizePracticeSearch).some(day =>
      day.length > 0 && new RegExp(`\\b${day}\\b`).test(normalized)
    ))
    .map(site => site.institutionId)
    .filter(institutionId => allowed.has(institutionId))
  const uniqueInstitutions = [...new Set(institutionsForMentionedDay)]
  return uniqueInstitutions.length === 1 ? uniqueInstitutions[0] : null
}
