import {
  createWhatsAppLocationsVersion,
  deleteWhatsAppLocation,
  getOperationalWhatsAppLocations,
  getWhatsAppLocationsStatus,
  isOperationallyVerifiedLocation,
  parseWhatsAppLocations,
  putWhatsAppLocation,
  whatsappLocationDeleteBodySchema,
  whatsappLocationPutBodySchema,
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

  it.each([
    {
      label: "practices vacío",
      services: ["Consulta cardiológica", "Ecocardiograma"],
      practices: [],
      expected: ["Consulta cardiológica", "Ecocardiograma"],
    },
    {
      label: "services vacío",
      services: [],
      practices: ["Ecocardiograma"],
      expected: ["Ecocardiograma"],
    },
    {
      label: "conjuntos equivalentes",
      services: ["Consulta cardiológica", "Ecocardiograma"],
      practices: ["Ecocardiograma", "Consulta cardiológica"],
      expected: ["Consulta cardiológica", "Ecocardiograma"],
    },
  ])("tolera un documento transicional compatible: $label", ({ services, practices, expected }) => {
    const result = parseWhatsAppLocations([canonicalLocation({ services, practices })])

    expect(result).toEqual(expect.objectContaining({ success: true, usedLegacyPractices: true }))
    if (!result.success) throw new Error("config transicional inesperadamente inválida")
    expect(result.data[0].services).toEqual(expected)
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

  it.each([
    "javascript:alert(1)",
    "data:text/html,contenido",
    "ftp://example.com/turnos",
    "http://example.com/turnos",
  ])("rechaza protocolos no HTTPS en enlaces operativos", unsafeUrl => {
    expect(parseWhatsAppLocations([
      canonicalLocation({ booking_url: unsafeUrl }),
    ])).toEqual({ success: false, data: [], usedLegacyPractices: false })
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

describe("edición independiente de sedes", () => {
  const VERSION = "a".repeat(64)

  it("genera una versión estable sin depender del orden de las claves", () => {
    expect(createWhatsAppLocationsVersion([{ id: "cimel_lanus", name: "CIMEL" }]))
      .toBe(createWhatsAppLocationsVersion([{ name: "CIMEL", id: "cimel_lanus" }]))
    expect(createWhatsAppLocationsVersion([{ id: "cimel_lanus", name: "CIMEL" }]))
      .not.toBe(createWhatsAppLocationsVersion([{ id: "cimel_lanus", name: "Otro" }]))
  })

  it("rechaza ID, evidencia y campos extra en el body de PUT", () => {
    const valid = {
      version: VERSION,
      confirmed: true,
      location: { name: "CIMEL Lanús", active: true, services: ["Consulta"] },
    }
    expect(whatsappLocationPutBodySchema.safeParse(valid).success).toBe(true)

    for (const invalid of [
      { ...valid, location: { ...valid.location, id: "cimel_lanus" } },
      { ...valid, location: { ...valid.location, verified_at: VERIFIED_AT } },
      { ...valid, confirmed: false },
      { ...valid, extra: true },
    ]) {
      expect(whatsappLocationPutBodySchema.safeParse(invalid).success).toBe(false)
    }
  })

  it("exige un body de DELETE cerrado y una versión válida", () => {
    expect(whatsappLocationDeleteBodySchema.safeParse({ version: VERSION }).success).toBe(true)
    expect(whatsappLocationDeleteBodySchema.safeParse({ version: "corta" }).success).toBe(false)
    expect(whatsappLocationDeleteBodySchema.safeParse({ version: VERSION, id: "cimel_lanus" }).success).toBe(false)
  })

  it("sella solo la sede objetivo y conserva exactamente la evidencia de las otras", () => {
    const other = canonicalLocation({
      id: "swiss_lomas",
      name: "Swiss Medical Lomas",
      verified_at: "2026-06-10T10:00:00.000Z",
      verified_by: "other-reviewer",
      valid_from: "2026-06-10T10:00:00.000Z",
    })
    const result = putWhatsAppLocation(
      [canonicalLocation(), other],
      "cimel_lanus",
      { name: "CIMEL Lanús", active: true, services: ["Consulta actualizada"] },
      "reviewer-new",
      NOW
    )

    expect(result.success).toBe(true)
    if (!result.success) throw new Error("mutación inválida")
    expect(result.data[0]).toEqual(expect.objectContaining({
      id: "cimel_lanus",
      services: ["Consulta actualizada"],
      verified_at: NOW.toISOString(),
      verified_by: "reviewer-new",
      valid_from: NOW.toISOString(),
    }))
    expect(result.data[1]).toEqual(expect.objectContaining({
      verified_at: "2026-06-10T10:00:00.000Z",
      verified_by: "other-reviewer",
      valid_from: "2026-06-10T10:00:00.000Z",
    }))
  })

  it("permite agregar una sede soportada sin recibir su ID en los datos editables", () => {
    const result = putWhatsAppLocation(
      [canonicalLocation()],
      "hospital_britanico",
      { name: "Hospital Británico", active: false, services: ["Consulta"] },
      "reviewer-new",
      NOW
    )
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("mutación inválida")
    expect(result.data.at(-1)).toEqual(expect.objectContaining({
      id: "hospital_britanico",
      active: false,
      verified_by: "reviewer-new",
    }))
  })

  it("elimina sin volver a sellar las sedes restantes", () => {
    const remaining = canonicalLocation({ id: "swiss_lomas", name: "Swiss Medical Lomas" })
    const result = deleteWhatsAppLocation(
      [canonicalLocation(), remaining],
      "cimel_lanus"
    )
    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({
        id: "swiss_lomas",
        verified_at: VERIFIED_AT,
        verified_by: "user-id-123",
        valid_from: VALID_FROM,
      })],
    })
    expect(deleteWhatsAppLocation([canonicalLocation()], "swiss_lomas"))
      .toEqual({ success: false, reason: "location_not_found" })
  })

  it("expone estados cerrados para la UI sin confundir inactiva con no verificada", () => {
    const parsed = parseWhatsAppLocations([
      canonicalLocation(),
      canonicalLocation({ id: "swiss_lomas", name: "Swiss", active: false }),
      canonicalLocation({ id: "hospital_britanico", name: "Británico", verified_by: null }),
    ])
    if (!parsed.success) throw new Error("config inesperadamente inválida")

    expect(getWhatsAppLocationsStatus(parsed.data, false, NOW).items).toEqual([
      expect.objectContaining({ id: "cimel_lanus", status: "operational", operational: true }),
      expect.objectContaining({ id: "swiss_lomas", status: "inactive", verified: true }),
      expect.objectContaining({ id: "hospital_britanico", status: "unverified", verified: false }),
    ])
  })
})
