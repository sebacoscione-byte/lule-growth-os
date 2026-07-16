import { z } from "zod"

export const WHATSAPP_LOCATION_IDS = [
  "cimel_lanus",
  "swiss_lomas",
  "hospital_britanico",
] as const

export type WhatsAppLocationId = (typeof WHATSAPP_LOCATION_IDS)[number]

const boundedText = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.union([boundedText(max), z.literal(""), z.null()]).optional()
const optionalUrl = z
  .union([z.string().trim().url().max(2_048), z.literal(""), z.null()])
  .optional()
const optionalTimestamp = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
const stringList = z.array(boundedText(120)).max(30)

const locationFields = {
  id: z.enum(WHATSAPP_LOCATION_IDS),
  name: boundedText(120),
  address: optionalText(300),
  google_maps_link: optionalUrl,
  phone: optionalText(80),
  whatsapp: optionalText(80),
  hours: optionalText(300),
  booking_url: optionalUrl,
  day: optionalText(80),
  booking_instruction: optionalText(1_000),
  obras_sociales: stringList.optional(),
  notes: optionalText(1_000),
  verified_at: optionalTimestamp,
  verified_by: optionalText(160),
  valid_from: optionalTimestamp,
  active: z.boolean().optional(),
}

/** Forma canónica. `services` es la única clave que se escribe de ahora en adelante. */
export const whatsappLocationSchema = z.object({
  ...locationFields,
  services: stringList.optional(),
}).strict()

/** Compatibilidad de lectura para registros creados por la UI histórica. */
const legacyWhatsAppLocationSchema = z.object({
  ...locationFields,
  practices: stringList.optional(),
}).strict()

function requireUniqueLocationIds(
  locations: Array<{ id: WhatsAppLocationId }>,
  ctx: z.RefinementCtx
): void {
    const ids = new Set<string>()
    for (const [index, location] of locations.entries()) {
      if (ids.has(location.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Los IDs de sede no pueden repetirse",
          path: [index, "id"],
        })
      }
      ids.add(location.id)
    }
}

/** Schema estricto para escrituras nuevas desde `/api/config`. */
export const whatsappLocationsSchema = z
  .array(whatsappLocationSchema)
  .max(WHATSAPP_LOCATION_IDS.length)
  .superRefine(requireUniqueLocationIds)

const rawLocationsSchema = z
  .array(z.union([whatsappLocationSchema, legacyWhatsAppLocationSchema]))
  .max(WHATSAPP_LOCATION_IDS.length)
  .superRefine(requireUniqueLocationIds)

type RawLocation = z.infer<typeof rawLocationsSchema>[number]

export interface WhatsAppLocationConfig {
  id: WhatsAppLocationId
  name: string
  address?: string
  google_maps_link?: string
  phone?: string
  whatsapp?: string
  hours?: string
  booking_url?: string
  day?: string
  booking_instruction?: string
  obras_sociales: string[]
  services: string[]
  notes?: string
  verified_at?: string
  verified_by?: string
  valid_from?: string
  active: boolean
}

export type WhatsAppLocationsParseResult =
  | { success: true; data: WhatsAppLocationConfig[]; usedLegacyPractices: boolean }
  | { success: false; data: []; usedLegacyPractices: false }

function nonEmpty(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined
}

function unique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()))]
}

function normalizeLocation(location: RawLocation): WhatsAppLocationConfig {
  const legacyServices = "practices" in location ? location.practices : undefined
  const canonicalServices = "services" in location ? location.services : undefined

  return {
    id: location.id,
    name: location.name.trim(),
    address: nonEmpty(location.address),
    google_maps_link: nonEmpty(location.google_maps_link),
    phone: nonEmpty(location.phone),
    whatsapp: nonEmpty(location.whatsapp),
    hours: nonEmpty(location.hours),
    booking_url: nonEmpty(location.booking_url),
    day: nonEmpty(location.day),
    booking_instruction: nonEmpty(location.booking_instruction),
    obras_sociales: unique(location.obras_sociales),
    services: unique(canonicalServices ?? legacyServices),
    notes: nonEmpty(location.notes),
    verified_at: location.verified_at ?? undefined,
    verified_by: nonEmpty(location.verified_by),
    valid_from: location.valid_from ?? undefined,
    active: location.active ?? true,
  }
}

/**
 * Valida el valor completo de `app_config.locations`. Ante una fila desconocida,
 * duplicada o mal formada se rechaza todo el documento: el bot no debe mezclar
 * datos confiables con una configuración parcialmente corrupta.
 */
export function parseWhatsAppLocations(value: unknown): WhatsAppLocationsParseResult {
  const parsed = rawLocationsSchema.safeParse(value)
  if (!parsed.success) {
    return { success: false, data: [], usedLegacyPractices: false }
  }

  return {
    success: true,
    data: parsed.data.map(normalizeLocation),
    usedLegacyPractices: parsed.data.some(location => "practices" in location),
  }
}

/**
 * Un dato operativo solo se puede afirmar si fue activado y tiene trazabilidad
 * de verificación vigente. Las filas legacy se pueden editar/migrar, pero no se
 * publican al paciente hasta completar estos metadatos.
 */
export function isOperationallyVerifiedLocation(
  location: WhatsAppLocationConfig,
  now: Date = new Date()
): boolean {
  if (!location.active || !location.verified_at || !location.verified_by || !location.valid_from) {
    return false
  }

  const nowMs = now.getTime()
  const verifiedAt = Date.parse(location.verified_at)
  const validFrom = Date.parse(location.valid_from)
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(validFrom)) return false

  // Tolera hasta cinco minutos de diferencia de reloj, pero no fechas futuras arbitrarias.
  return verifiedAt <= nowMs + 5 * 60_000 && validFrom <= nowMs
}

export function getOperationalWhatsAppLocations(
  value: unknown,
  now: Date = new Date()
): WhatsAppLocationConfig[] {
  const parsed = parseWhatsAppLocations(value)
  return parsed.success
    ? parsed.data.filter(location => isOperationallyVerifiedLocation(location, now))
    : []
}
