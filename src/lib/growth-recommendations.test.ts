import {
  checkLowInteractionLanding,
  checkZeroVisitLanding,
  checkMissingObrasSociales,
  checkHeroAbTestSignal,
  checkWhatsAppBudget,
  checkUnapprovedTemplates,
  checkAbandonedConversations,
  checkInstagramNotConnected,
  checkAutoPublishAllDisabled,
  checkAutoPublishError,
  checkStaleInstagramPublishing,
  checkGooglePlacesUnavailable,
  checkFewGoogleReviews,
  checkLowGoogleRating,
  checkGoogleBusinessNotConnected,
  buildGrowthRecommendations,
  type GrowthRecommendationsInput,
} from "./growth-recommendations"
import type { AutoPublishTrackSettings } from "@/types"
import type { GooglePlaceReviews } from "@/lib/google-places"

const DISABLED_TRACK: AutoPublishTrackSettings = {
  enabled: false, times_per_week: 2, starts_at: null, last_published_at: null, last_run_at: null, last_run_result: null,
}

describe("web / landings", () => {
  it("avisa si una landing tiene muchas visitas y baja interacción", () => {
    const rec = checkLowInteractionLanding({ slug: "cardiologa-lanus", label: "Cardióloga en Lanús", visits: 25, rate: 10 })
    expect(rec?.channel).toBe("web")
    expect(rec?.severity).toBe("warning")
  })

  it("no avisa si hay pocas visitas aunque la tasa sea baja", () => {
    expect(checkLowInteractionLanding({ slug: "x", label: "X", visits: 5, rate: 0 })).toBeNull()
  })

  it("no avisa si la tasa de interacción es aceptable", () => {
    expect(checkLowInteractionLanding({ slug: "x", label: "X", visits: 100, rate: 40 })).toBeNull()
  })

  it("avisa si una landing no tuvo ninguna visita", () => {
    expect(checkZeroVisitLanding({ slug: "x", label: "X", visits: 0, rate: 0 })?.severity).toBe("info")
  })

  it("no avisa si tuvo al menos una visita", () => {
    expect(checkZeroVisitLanding({ slug: "x", label: "X", visits: 1, rate: 0 })).toBeNull()
  })

  it("avisa si una sede no tiene obras sociales cargadas", () => {
    expect(checkMissingObrasSociales("Swiss Medical Lomas", [])?.channel).toBe("web")
    expect(checkMissingObrasSociales("Swiss Medical Lomas", undefined)).not.toBeNull()
  })

  it("no avisa si la sede tiene obras sociales cargadas", () => {
    expect(checkMissingObrasSociales("CIMEL Lanús", ["OSDE", "Swiss Medical"])).toBeNull()
  })

  it("sugiere cortar el test A/B cuando hay suficientes visitas y una diferencia clara", () => {
    const rec = checkHeroAbTestSignal([
      { variant: "a", visits: 200, interactionRate: 30 },
      { variant: "b", visits: 180, interactionRate: 15 },
    ])
    expect(rec?.message).toContain("A (Pedir turno primero)")
  })

  it("no dice nada si todavía no hay suficientes visitas por variante", () => {
    const rec = checkHeroAbTestSignal([
      { variant: "a", visits: 50, interactionRate: 30 },
      { variant: "b", visits: 40, interactionRate: 15 },
    ])
    expect(rec).toBeNull()
  })

  it("no dice nada si la diferencia entre variantes es chica", () => {
    const rec = checkHeroAbTestSignal([
      { variant: "a", visits: 200, interactionRate: 20 },
      { variant: "b", visits: 200, interactionRate: 22 },
    ])
    expect(rec).toBeNull()
  })
})

describe("whatsapp", () => {
  it("avisa si el costo proyectado supera el presupuesto", () => {
    expect(checkWhatsAppBudget(50000, 30000)?.severity).toBe("warning")
  })

  it("no avisa si no hay presupuesto configurado", () => {
    expect(checkWhatsAppBudget(50000, null)).toBeNull()
  })

  it("no avisa si el costo proyectado está dentro del presupuesto", () => {
    expect(checkWhatsAppBudget(10000, 30000)).toBeNull()
  })

  it("avisa si hay templates sin aprobar", () => {
    expect(checkUnapprovedTemplates(3)?.message).toContain("3 templates")
  })

  it("no avisa si no hay templates pendientes", () => {
    expect(checkUnapprovedTemplates(0)).toBeNull()
  })

  it("avisa si hay conversaciones abandonadas", () => {
    expect(checkAbandonedConversations(2)?.href).toBe("/inbox")
  })

  it("no avisa si no hay conversaciones abandonadas", () => {
    expect(checkAbandonedConversations(0)).toBeNull()
  })
})

describe("instagram", () => {
  it("avisa si Instagram no está conectado", () => {
    expect(checkInstagramNotConnected(false)?.severity).toBe("warning")
  })

  it("no avisa si está conectado", () => {
    expect(checkInstagramNotConnected(true)).toBeNull()
  })

  it("avisa si ambos tracks de publicación automática están apagados", () => {
    expect(checkAutoPublishAllDisabled(DISABLED_TRACK, DISABLED_TRACK)).not.toBeNull()
  })

  it("no avisa si al menos un track está prendido", () => {
    const enabled: AutoPublishTrackSettings = { ...DISABLED_TRACK, enabled: true }
    expect(checkAutoPublishAllDisabled(enabled, DISABLED_TRACK)).toBeNull()
  })

  it("avisa si la última corrida de un track dio error", () => {
    const errored: AutoPublishTrackSettings = { ...DISABLED_TRACK, enabled: true, last_run_result: "error: quota exceeded" }
    expect(checkAutoPublishError(errored, "Posts")?.message).toContain("Posts")
  })

  it("no avisa por error si el track está apagado", () => {
    const errored: AutoPublishTrackSettings = { ...DISABLED_TRACK, enabled: false, last_run_result: "error: algo" }
    expect(checkAutoPublishError(errored, "Posts")).toBeNull()
  })

  it("avisa si un track activado no publica hace mucho", () => {
    const now = new Date("2026-07-07T12:00:00Z")
    const stale: AutoPublishTrackSettings = {
      ...DISABLED_TRACK, enabled: true, last_published_at: "2026-06-01T00:00:00Z",
    }
    expect(checkStaleInstagramPublishing(stale, "Posts", now)?.severity).toBe("warning")
  })

  it("no avisa si publicó hace poco", () => {
    const now = new Date("2026-07-07T12:00:00Z")
    const recent: AutoPublishTrackSettings = {
      ...DISABLED_TRACK, enabled: true, last_published_at: "2026-07-05T00:00:00Z",
    }
    expect(checkStaleInstagramPublishing(recent, "Posts", now)).toBeNull()
  })

  it("no avisa por antigüedad si el track está apagado", () => {
    const now = new Date("2026-07-07T12:00:00Z")
    expect(checkStaleInstagramPublishing(DISABLED_TRACK, "Posts", now)).toBeNull()
  })
})

describe("google maps", () => {
  const reviews: GooglePlaceReviews = { reviews: [], rating: 4.8, reviewCount: 20, mapsUrl: "https://maps.google.com/x" }

  it("avisa si no se pudieron traer reseñas", () => {
    expect(checkGooglePlacesUnavailable(null)?.channel).toBe("google")
  })

  it("no avisa si hay datos", () => {
    expect(checkGooglePlacesUnavailable(reviews)).toBeNull()
  })

  it("avisa si hay pocas reseñas", () => {
    expect(checkFewGoogleReviews({ ...reviews, reviewCount: 2 })?.severity).toBe("info")
  })

  it("no avisa si hay suficientes reseñas", () => {
    expect(checkFewGoogleReviews(reviews)).toBeNull()
  })

  it("avisa si el rating es bajo con suficientes reseñas", () => {
    expect(checkLowGoogleRating({ ...reviews, rating: 3.5, reviewCount: 10 })?.severity).toBe("warning")
  })

  it("no avisa por rating bajo si hay muy pocas reseñas todavía", () => {
    expect(checkLowGoogleRating({ ...reviews, rating: 3.5, reviewCount: 1 })).toBeNull()
  })

  it("no avisa si el rating es bueno", () => {
    expect(checkLowGoogleRating(reviews)).toBeNull()
  })

  it("avisa si Google Business no está conectado", () => {
    expect(checkGoogleBusinessNotConnected(false)?.href).toBe("/google-local")
  })

  it("no avisa si está conectado", () => {
    expect(checkGoogleBusinessNotConnected(true)).toBeNull()
  })
})

describe("buildGrowthRecommendations", () => {
  const baseInput: GrowthRecommendationsInput = {
    now: new Date("2026-07-07T12:00:00Z"),
    landingRanking: [],
    heroVariantResults: [],
    locations: [],
    whatsapp: { projectedMonthlyCost: 0, monthlyCostAlertArs: null, unapprovedTemplatesCount: 0, abandonedConversations: 0 },
    instagram: { connected: true, post: DISABLED_TRACK, historia: DISABLED_TRACK },
    google: { businessConnected: true, placesReviews: { reviews: [], rating: 4.8, reviewCount: 20, mapsUrl: null } },
  }

  it("no devuelve nada si todo está bien y no hay datos que disparen reglas", () => {
    const recs = buildGrowthRecommendations({
      ...baseInput,
      instagram: { connected: true, post: { ...DISABLED_TRACK, enabled: true, last_published_at: "2026-07-06T00:00:00Z" }, historia: DISABLED_TRACK },
    })
    expect(recs).toEqual([])
  })

  it("ordena por severidad: critical, warning, info", () => {
    const recs = buildGrowthRecommendations({
      ...baseInput,
      landingRanking: [{ slug: "x", label: "X", visits: 0, rate: 0 }], // info
      whatsapp: { ...baseInput.whatsapp, unapprovedTemplatesCount: 1 }, // warning
      instagram: { connected: false, post: DISABLED_TRACK, historia: DISABLED_TRACK }, // warning
    })
    const severities = recs.map(r => r.severity)
    expect(severities.indexOf("warning")).toBeLessThan(severities.indexOf("info"))
  })

  it("genera una recomendación por cada landing con baja interacción", () => {
    const recs = buildGrowthRecommendations({
      ...baseInput,
      landingRanking: [
        { slug: "a", label: "A", visits: 30, rate: 5 },
        { slug: "b", label: "B", visits: 30, rate: 5 },
      ],
    })
    expect(recs.filter(r => r.id.startsWith("web-low-rate")).length).toBe(2)
  })
})
