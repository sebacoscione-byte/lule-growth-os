import {
  getOperationalWhatsAppLocations,
  isOperationallyVerifiedLocation,
  parseWhatsAppLocations,
} from "@/lib/whatsapp-location-config"

const VERIFIED_AT = "2026-07-15T12:00:00.000Z"
const VALID_FROM = "2026-07-01T00:00:00.000Z"
const NOW = new Date("2026-07-16T12:00:00.000Z")

function canonicalLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: "cimel_lanus",
    name: "CIMEL Lanús",
    services: ["Consulta cardiológica", "Ecocardiograma"],
    verified_at: VERIFIED_AT,
    verified_by: "user-id-123",
    valid_from: VALID_FROM,
    active: true,
    ...overrides,
  }
}

describe("parseWhatsAppLocations", () => {
  it("acepta la forma canónica y conserva `services` como única fuente", () => {
    const result = parseWhatsAppLocations([canonicalLocation()])

    expect(result).toEqual(expect.objectContaining({ success: true, usedLegacyPractices: false }))
    if (!result.success) throw new Error("config inesperadamente inválida")
    expect(result.data[0]).toEqual(expect.objectContaining({
      id: "cimel_lanus",
      services: ["Consulta cardiológica", "Ecocardiograma"],
      active: true,
    }))
    expect(result.data[0]).not.toHaveProperty("practices")
  })

  it("lee `practices` legacy y lo normaliza a `services` sin duplicar claves", () => {
    const legacy = canonicalLocation()
    const withoutServices = {
      id: legacy.id,
      name: legacy.name,
      verified_at: legacy.verified_at,
      verified_by: legacy.verified_by,
      valid_from: legacy.valid_from,
      active: legacy.active,
    }
    const result = parseWhatsAppLocations([{ ...withoutServices, practices: ["Ecocardiograma"] }])

    expect(result).toEqual(expect.objectContaining({ success: true, usedLegacyPractices: true }))
    if (!result.success) throw new Error("config legacy inesperadamente inválida")
    expect(result.data[0].services).toEqual(["Ecocardiograma"])
    expect(result.data[0]).not.toHaveProperty("practices")
  })

  it("rechaza documentos ambiguos que mezclan `services` y `practices`", () => {
    expect(parseWhatsAppLocations([
      { ...canonicalLocation(), practices: ["Ecocardiograma"] },
    ])).toEqual({ success: false, data: [], usedLegacyPractices: false })
  })

  it("falla cerrado para IDs duplicados, sedes desconocidas o campos extra", () => {
    const invalidDocuments = [
      [canonicalLocation(), canonicalLocation()],
      [canonicalLocation({ id: "sede_inventada" })],
      [canonicalLocation({ secret_field: "no permitido" })],
    ]

    for (const document of invalidDocuments) {
      expect(parseWhatsAppLocations(document)).toEqual({
        success: false,
        data: [],
        usedLegacyPractices: false,
      })
    }
  })
})

describe("verificación operativa", () => {
  it("solo habilita filas activas, verificadas y cuya vigencia ya comenzó", () => {
    const parsed = parseWhatsAppLocations([canonicalLocation()])
    if (!parsed.success) throw new Error("config inesperadamente inválida")

    expect(isOperationallyVerifiedLocation(parsed.data[0], NOW)).toBe(true)
    expect(getOperationalWhatsAppLocations([canonicalLocation()], NOW)).toHaveLength(1)
  })

  it.each([
    ["sin verified_at", { verified_at: null }],
    ["sin verified_by", { verified_by: null }],
    ["sin valid_from", { valid_from: null }],
    ["inactiva", { active: false }],
    ["aún no vigente", { valid_from: "2026-07-17T00:00:00.000Z" }],
    ["verificación futura", { verified_at: "2026-07-17T00:00:00.000Z" }],
  ])("no publica una sede %s", (_label, overrides) => {
    expect(getOperationalWhatsAppLocations([canonicalLocation(overrides)], NOW)).toEqual([])
  })

  it("mantiene legible una fila legacy, pero no la publica sin metadatos", () => {
    const result = parseWhatsAppLocations([{
      id: "hospital_britanico",
      name: "Hospital Británico",
      practices: ["Consulta cardiológica"],
    }])

    expect(result.success).toBe(true)
    expect(getOperationalWhatsAppLocations([{
      id: "hospital_britanico",
      name: "Hospital Británico",
      practices: ["Consulta cardiológica"],
    }], NOW)).toEqual([])
  })
})
