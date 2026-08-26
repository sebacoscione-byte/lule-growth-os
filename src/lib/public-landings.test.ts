import { LANDING_DATA, resolvesToBotNumber, WHATSAPP_NUMBER } from "./public-landings"

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
        address: "Av. Hipólito Yrigoyen 4429, Lanús",
        hours: "Martes 16:00–19:30 · Ecocardiogramas",
      }),
      expect.objectContaining({
        key: "britanico-central",
        trackingKey: "britanico",
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
      name: "Hospital Británico Lanús",
    }))
  })
})
