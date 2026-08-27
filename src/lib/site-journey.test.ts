import { buildWebsiteJourneySteps, websiteJourneyPercentage } from "./site-journey"

describe("website journey detail", () => {
  it("reconstructs the campaign table from unique-session aggregates", () => {
    const steps = buildWebsiteJourneySteps({
      visits: 466,
      activeVisits: 57,
      bookingOptionsVisits: 56,
      heroBookingVisits: 0,
      whatsappVisits: 0,
      callVisits: 0,
      bookingVisits: 0,
      mapsVisits: 1,
    }, 0)

    expect(steps).toEqual([
      { key: "visits", label: "Entraron a la web", sessions: 466 },
      { key: "inactive", label: "No hicieron nada más", sessions: 409 },
      { key: "booking_options", label: "Llegaron a ver las opciones de sedes", sessions: 56 },
      { key: "hero_booking", label: "Tocaron “Pedir turno” del encabezado", sessions: 0 },
      { key: "whatsapp", label: "Tocaron WhatsApp", sessions: 0 },
      { key: "call", label: "Tocaron llamar", sessions: 0 },
      { key: "booking", label: "Tocaron turno online", sessions: 0 },
      { key: "maps", label: "Tocaron Google Maps", sessions: 1 },
      { key: "leads", label: "Consultas registradas", sessions: 0 },
    ])
  })

  it("formats rates against visits and stays safe with missing data", () => {
    expect(websiteJourneyPercentage(409, 466)).toBe(87.8)
    expect(websiteJourneyPercentage(1, 466)).toBe(0.2)
    expect(websiteJourneyPercentage(3, 0)).toBe(0)
  })

  it("never reports more inactive sessions than visits", () => {
    const steps = buildWebsiteJourneySteps({
      visits: 2,
      activeVisits: 3,
      bookingOptionsVisits: Number.NaN,
      heroBookingVisits: 0,
      whatsappVisits: 0,
      callVisits: 0,
      bookingVisits: 0,
      mapsVisits: 0,
    }, -1)

    expect(steps.find(step => step.key === "inactive")?.sessions).toBe(0)
    expect(steps.find(step => step.key === "booking_options")?.sessions).toBe(0)
    expect(steps.find(step => step.key === "leads")?.sessions).toBe(0)
  })
})
