import {
  LANDING_DATA,
  resolvePublicLocationWhatsApp,
  resolvesToBotNumber,
  WHATSAPP_NUMBER,
} from "./public-landings"

describe("resolvesToBotNumber (GROWTH-01)", () => {
  it("es true sin rawNumber (usa el número del bot por default)", () => {
    expect(resolvesToBotNumber(undefined)).toBe(true)
  })

  it("es false si la sede tiene un WhatsApp propio distinto (ej. Swity de Swiss Medical)", () => {
    expect(resolvesToBotNumber("11 5051-9982")).toBe(false)
  })

  it("es true si el override normalizado coincide con el número del bot", () => {
    // WHATSAPP_NUMBER ya viene con 549 al frente -- probamos con el mismo número en formato local.
    const local = WHATSAPP_NUMBER.replace(/^549/, "")
    expect(resolvesToBotNumber(local)).toBe(true)
  })
})

describe("cronograma público vigente", () => {
  it("publica las cuatro sedes con claves únicas y horarios confirmados", () => {
    const locations = LANDING_DATA["dra-lucia-chahin"].locations

    expect(locations).toHaveLength(4)
    expect(new Set(locations.map(location => location.key)).size).toBe(4)
    expect(locations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "cimel",
        day: "martes, jueves y viernes",
        hours: "Martes 13:00–15:00\nJueves y viernes 13:00–16:00",
      }),
      expect.objectContaining({
        key: "britanico-lanus",
        trackingKey: "britanico",
        analyticsKey: "britanico_lanus",
        address: "Av. Hipólito Yrigoyen 4429, Lanús",
        hours: "Martes 16:00–19:30 · Ecocardiogramas",
      }),
      expect.objectContaining({
        key: "britanico-central",
        trackingKey: "britanico",
        analyticsKey: "britanico_central",
        hours: "Miércoles 17:00–19:45",
      }),
      expect.objectContaining({ key: "swiss", hours: "Viernes 17:00–20:00" }),
    ]))
  })

  it("deriva ecocardiograma en Lanús a Hospital Británico Lanús", () => {
    const landing = LANDING_DATA["ecocardiograma-lanus"]
    expect(landing.locations).toHaveLength(1)
    expect(landing.locations[0]).toEqual(expect.objectContaining({
      key: "britanico-lanus",
      trackingKey: "britanico",
      analyticsKey: "britanico_lanus",
      name: "Hospital Británico Lanús",
    }))
  })
})

describe("WhatsApp compartido del Hospital Británico", () => {
  const locations = [
    { name: "Hospital Británico", whatsapp: "11 2345-6789" },
    { name: "Swiss Medical Lomas", whatsapp: "11 9876-5432" },
  ]

  it("usa el mismo WhatsApp institucional en Central y Lanús", () => {
    expect(resolvePublicLocationWhatsApp("Hospital Británico (Central)", locations)).toBe("11 2345-6789")
    expect(resolvePublicLocationWhatsApp("Hospital Británico Lanús", locations)).toBe("11 2345-6789")
  })

  it("prioriza un WhatsApp específico y no comparte números con otras instituciones", () => {
    expect(resolvePublicLocationWhatsApp("Hospital Británico Lanús", locations, "11 1111-2222"))
      .toBe("11 1111-2222")
    expect(resolvePublicLocationWhatsApp("CIMEL Lanús", locations)).toBeUndefined()
  })
})
