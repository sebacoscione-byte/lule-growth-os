import { createHash } from "node:crypto"
import { z } from "zod"

export const WHATSAPP_LOCATION_IDS = [
  "cimel_lanus",
  "swiss_lomas",
  "hospital_britanico",
] as const

export type WhatsAppLocationId = (typeof WHATSAPP_LOCATION_IDS)[number]

const boundedText = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.union([boundedText(max), z.literal(""), z.null()]).optional()
const httpsUrl = z.string().trim().url().max(2_048).refine(value => {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}, "La URL debe usar HTTPS")
const optionalUrl = z
  .union([httpsUrl, z.literal(""), z.null()])
  .optional()
const optionalTimestamp = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
const stringList = z.array(boundedText(120)).max(30)

const editableLocationFields = {
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
  accepts_particular: z.boolean().optional(),
  notes: optionalText(1_000),
  active: z.boolean().optional(),
}

const verificationFields = {
  verified_at: optionalTimestamp,
  verified_by: optionalText(160),
  valid_from: optionalTimestamp,
}

const locationFields = {
  id: z.enum(WHATSAPP_LOCATION_IDS),
  ...editableLocationFields,
  ...verificationFields,
}

/**
 * Datos que una persona puede confirmar para una sola sede. El ID viaja en la URL y los
 * metadatos de verificación los escribe exclusivamente el servidor.
 */
export const whatsappLocationInputSchema = z.object({
  ...editableLocationFields,
  active: z.boolean(),
  services: stringList.optional(),
}).strict()

const locationsVersionSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const whatsappLocationPutBodySchema = z.object({
  version: locationsVersionSchema,
  confirmed: z.literal(true),
  location: whatsappLocationInputSchema,
}).strict()

export const whatsappLocationDeleteBodySchema = z.object({
  version: locationsVersionSchema,
}).strict()

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

/**
 * Compatibilidad acotada para el estado transicional que dejó la UI histórica: ambas claves
 * pueden coexistir sólo si una está vacía o si representan exactamente el mismo conjunto. Una
 * divergencia real sigue fallando cerrada para no elegir silenciosamente datos operativos.
 */
const transitionalWhatsAppLocationSchema = z.object({
  ...locationFields,
  services: stringList,
  practices: stringList,
}).strict().superRefine((location, ctx) => {
  const canonical = [...new Set(location.services.map(value => value.trim()))].sort()
  const legacy = [...new Set(location.practices.map(value => value.trim()))].sort()
  const compatible = canonical.length === 0
    || legacy.length === 0
    || JSON.stringify(canonical) === JSON.stringify(legacy)

  if (!compatible) {
    ctx.addIssue({
      code: "custom",
      message: "services y practices contienen valores incompatibles",
      path: ["practices"],
    })
  }
})

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
  .array(z.union([
    whatsappLocationSchema,
    legacyWhatsAppLocationSchema,
    transitionalWhatsAppLocationSchema,
  ]))
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
  accepts_particular: boolean
  services: string[]
  notes?: string
  verified_at?: string
  verified_by?: string
  valid_from?: string
  active: boolean
}

export type WhatsAppLocationInput = z.infer<typeof whatsappLocationInputSchema>

export type WhatsAppLocationOperationalStatus =
  | "operational"
  | "inactive"
  | "unverified"
  | "not_yet_valid"

export interface WhatsAppLocationStatus {
  id: WhatsAppLocationId
  status: WhatsAppLocationOperationalStatus
  active: boolean
  verified: boolean
  operational: boolean
}

export interface WhatsAppLocationsStatus {
  valid: true
  used_legacy_practices: boolean
  items: WhatsAppLocationStatus[]
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

  const rawCoverages = unique(location.obras_sociales)
  const legacyParticular = rawCoverages.some(value => value.toLowerCase() === "particular")

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
    obras_sociales: rawCoverages.filter(value => value.toLowerCase() !== "particular"),
    accepts_particular: location.accepts_particular ?? legacyParticular,
    services: unique(canonicalServices?.length ? canonicalServices : legacyServices ?? canonicalServices),
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

/** Token opaco para control optimista. El CAS de base de datos sigue comparando el JSON completo. */
export function createWhatsAppLocationsVersion(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function verificationState(
  location: WhatsAppLocationConfig,
  now: Date
): { verified: boolean; notYetValid: boolean } {
  if (!location.verified_at || !location.verified_by || !location.valid_from) {
    return { verified: false, notYetValid: false }
  }

  const nowMs = now.getTime()
  const verifiedAt = Date.parse(location.verified_at)
  const validFrom = Date.parse(location.valid_from)
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(validFrom)) {
    return { verified: false, notYetValid: false }
  }
  if (verifiedAt > nowMs + 5 * 60_000) return { verified: false, notYetValid: false }
  if (validFrom > nowMs) return { verified: true, notYetValid: true }
  return { verified: true, notYetValid: false }
}

export function getWhatsAppLocationsStatus(
  locations: WhatsAppLocationConfig[],
  usedLegacyPractices = false,
  now: Date = new Date()
): WhatsAppLocationsStatus {
  return {
    valid: true,
    used_legacy_practices: usedLegacyPractices,
    items: locations.map(location => {
      const verification = verificationState(location, now)
      const operational = location.active && verification.verified && !verification.notYetValid
      const status: WhatsAppLocationOperationalStatus = operational
        ? "operational"
        : verification.notYetValid
          ? "not_yet_valid"
          : verification.verified && !location.active
            ? "inactive"
            : "unverified"
      return {
        id: location.id,
        status,
        active: location.active,
        verified: verification.verified,
        operational,
      }
    }),
  }
}

export type WhatsAppLocationDocumentMutation =
  | { success: true; data: WhatsAppLocationConfig[] }
  | { success: false; reason: "invalid_document" | "location_not_found" }

/**
 * Reemplaza/agrega una sola sede y vuelve a sellar exclusivamente esa fila. El resto siempre
 * parte del documento autoritativo del servidor, no de una copia enviada por el navegador.
 */
export function putWhatsAppLocation(
  currentValue: unknown,
  id: WhatsAppLocationId,
  input: WhatsAppLocationInput,
  actorUserId: string,
  now: Date = new Date()
): WhatsAppLocationDocumentMutation {
  const current = parseWhatsAppLocations(currentValue)
  if (!current.success) return { success: false, reason: "invalid_document" }

  const verifiedAt = now.toISOString()
  const nextLocation: WhatsAppLocationConfig = normalizeLocation({
    id,
    ...input,
    verified_at: verifiedAt,
    verified_by: actorUserId,
    valid_from: verifiedAt,
  })
  const existingIndex = current.data.findIndex(location => location.id === id)
  if (existingIndex === -1) {
    return { success: true, data: [...current.data, nextLocation] }
  }

  return {
    success: true,
    data: current.data.map((location, index) => index === existingIndex ? nextLocation : location),
  }
}

/** Elimina solo la sede indicada sin alterar ni renovar evidencia de las restantes. */
export function deleteWhatsAppLocation(
  currentValue: unknown,
  id: WhatsAppLocationId
): WhatsAppLocationDocumentMutation {
  const current = parseWhatsAppLocations(currentValue)
  if (!current.success) return { success: false, reason: "invalid_document" }
  if (!current.data.some(location => location.id === id)) {
    return { success: false, reason: "location_not_found" }
  }
  return { success: true, data: current.data.filter(location => location.id !== id) }
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
  const verification = verificationState(location, now)
  return location.active && verification.verified && !verification.notYetValid
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
