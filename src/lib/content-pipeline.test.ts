import {
  shouldRunAutoPublish, isScheduledForFuture, isTodayScheduledDay, alreadyPublishedToday,
  estimateAutoPublishDrainDays, pickNextPublishableItem, resolveChannelsToPublish, DEFAULT_AUTO_PUBLISH_SETTINGS,
} from "@/lib/content-pipeline"
import type { AutoPublishTrackSettings, ContentItem } from "@/types"

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "1",
    topic: "Tema",
    category: "Categoria",
    format: "post",
    goal: "",
    status: "approved",
    channels: ["instagram", "google_business"],
    hook: "hook",
    caption: "caption",
    google_text: "google text",
    hashtags: "#tag",
    visual_headline: "titulo",
    visual_subtitle: "subtitulo",
    visual_style: "rose",
    source: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    approved_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function track(overrides: Partial<AutoPublishTrackSettings> = {}): AutoPublishTrackSettings {
  return { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, ...overrides }
}

describe("shouldRunAutoPublish", () => {
  // 2026-07-10 = viernes (5), 2026-07-07 = martes (2), 2026-07-15 = miercoles (3)
  it("no corre si esta deshabilitado", () => {
    expect(shouldRunAutoPublish(track({ enabled: false, days_of_week: [5] }), new Date("2026-07-10T09:00:00.000Z"))).toBe(false)
  })

  it("no corre si no eligio ningun dia de la semana", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    expect(shouldRunAutoPublish(track({ enabled: true, days_of_week: [] }), now)).toBe(false)
  })

  it("no corre si hoy no es uno de los dias elegidos", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes
    const t = track({ enabled: true, days_of_week: [2] }) // solo martes
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre si hoy es uno de los dias elegidos y nunca publico antes", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes
    const t = track({ enabled: true, days_of_week: [5], last_published_at: null })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("no corre si ya publico hoy mismo (evita duplicar si el cron corre dos veces)", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes
    const t = track({ enabled: true, days_of_week: [5], last_published_at: "2026-07-10T06:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre si hoy es un dia elegido pero la ultima publicacion fue otro dia", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes
    const t = track({ enabled: true, days_of_week: [2, 5], last_published_at: "2026-07-07T09:00:00.000Z" }) // martes
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("no corre si tiene una fecha de inicio programada que todavia no llego, aunque hoy sea un dia elegido", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes
    const t = track({ enabled: true, days_of_week: [5], last_published_at: null, starts_at: "2026-07-15T00:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre una vez que se cumple la fecha de inicio programada, si ademas hoy es un dia elegido", () => {
    const now = new Date("2026-07-15T12:00:00.000Z") // miercoles
    const t = track({ enabled: true, days_of_week: [3], last_published_at: null, starts_at: "2026-07-15T00:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })
})

describe("isTodayScheduledDay", () => {
  it("true si el dia de now esta en days_of_week", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes = 5
    expect(isTodayScheduledDay(track({ days_of_week: [2, 5] }), now)).toBe(true)
  })

  it("false si el dia de now no esta en days_of_week", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    expect(isTodayScheduledDay(track({ days_of_week: [2] }), now)).toBe(false)
  })
})

describe("alreadyPublishedToday", () => {
  it("false si nunca publico", () => {
    expect(alreadyPublishedToday(track({ last_published_at: null }), new Date())).toBe(false)
  })

  it("true si last_published_at es el mismo dia calendario", () => {
    const now = new Date("2026-07-10T20:00:00.000Z")
    expect(alreadyPublishedToday(track({ last_published_at: "2026-07-10T06:00:00.000Z" }), now)).toBe(true)
  })

  it("false si last_published_at fue otro dia", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    expect(alreadyPublishedToday(track({ last_published_at: "2026-07-09T09:00:00.000Z" }), now)).toBe(false)
  })
})

describe("estimateAutoPublishDrainDays", () => {
  it("0 si la cola esta vacia", () => {
    expect(estimateAutoPublishDrainDays(0, [1, 4], new Date("2026-07-10T12:00:00.000Z"))).toBe(0)
  })

  it("0 si no hay ningun dia elegido", () => {
    expect(estimateAutoPublishDrainDays(3, [], new Date("2026-07-10T12:00:00.000Z"))).toBe(0)
  })

  it("cuenta dias de calendario hasta agotar la cola publicando en los dias elegidos", () => {
    // viernes 2026-07-10, eligiendo martes(2) y jueves(4): la 1ra ocurrencia es el martes siguiente (4 dias)
    const now = new Date("2026-07-10T12:00:00.000Z")
    expect(estimateAutoPublishDrainDays(1, [2, 4], now)).toBe(4)
  })
})

describe("isScheduledForFuture", () => {
  it("false si no tiene starts_at", () => {
    expect(isScheduledForFuture(track({ starts_at: null }), new Date())).toBe(false)
  })

  it("true si starts_at todavia no llego", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    expect(isScheduledForFuture(track({ starts_at: "2026-07-15T00:00:00.000Z" }), now)).toBe(true)
  })

  it("false si starts_at ya paso", () => {
    const now = new Date("2026-07-20T09:00:00.000Z")
    expect(isScheduledForFuture(track({ starts_at: "2026-07-15T00:00:00.000Z" }), now)).toBe(false)
  })
})

describe("pickNextPublishableItem", () => {
  it("devuelve null si no hay aprobados del formato pedido", () => {
    expect(pickNextPublishableItem([item({ status: "draft" })], "post")).toBeNull()
  })

  it("ignora reels y carruseles, quedan pendientes de accion manual", () => {
    const reel = item({ id: "reel", format: "reel" })
    const carrusel = item({ id: "carrusel", format: "carrusel" })
    expect(pickNextPublishableItem([reel, carrusel], "post")).toBeNull()
  })

  it("elige el aprobado mas antiguo por approved_at, del formato pedido", () => {
    const viejo = item({ id: "viejo", format: "post", approved_at: "2026-07-01T00:00:00.000Z" })
    const nuevo = item({ id: "nuevo", format: "post", approved_at: "2026-07-05T00:00:00.000Z" })
    expect(pickNextPublishableItem([nuevo, viejo], "post")?.id).toBe("viejo")
  })

  it("un post aprobado no se elige para el track de historias, y viceversa", () => {
    const post = item({ id: "post", format: "post" })
    const historia = item({ id: "historia", format: "historia" })
    expect(pickNextPublishableItem([post, historia], "historia")?.id).toBe("historia")
    expect(pickNextPublishableItem([post, historia], "post")?.id).toBe("post")
  })
})

describe("resolveChannelsToPublish", () => {
  it("intersecta los canales del item con los habilitados globalmente", () => {
    const result = resolveChannelsToPublish(
      item({ channels: ["instagram", "google_business"] }),
      ["instagram"]
    )
    expect(result).toEqual(["instagram"])
  })

  it("devuelve vacio si el item no pide ningun canal habilitado", () => {
    const result = resolveChannelsToPublish(
      item({ channels: ["google_business"] }),
      ["instagram"]
    )
    expect(result).toEqual([])
  })

  it("excluye canales que ya se publicaron con exito, para no duplicar un reintento parcial", () => {
    const result = resolveChannelsToPublish(
      item({ channels: ["instagram", "google_business"], auto_publish_result: { instagram: "published", google_business: "error" } }),
      ["instagram", "google_business"]
    )
    expect(result).toEqual(["google_business"])
  })
})
