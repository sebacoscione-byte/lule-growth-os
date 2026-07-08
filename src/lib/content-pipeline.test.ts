import {
  shouldRunAutoPublish, isScheduledForFuture, isTodayScheduledDay, alreadyPublishedToday,
  estimateAutoPublishDrainDays, estimateAutoPublishDateForPosition, pickNextPublishableItem,
  pickNextPublishableItems, moveItemInQueue, resolveChannelsToPublish, DEFAULT_AUTO_PUBLISH_SETTINGS,
  isRepeatDue,
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
    expect(estimateAutoPublishDrainDays(0, [1, 4], 1, new Date("2026-07-10T12:00:00.000Z"))).toBe(0)
  })

  it("0 si no hay ningun dia elegido", () => {
    expect(estimateAutoPublishDrainDays(3, [], 1, new Date("2026-07-10T12:00:00.000Z"))).toBe(0)
  })

  it("cuenta dias de calendario hasta agotar la cola publicando en los dias elegidos", () => {
    // viernes 2026-07-10, eligiendo martes(2) y jueves(4): la 1ra ocurrencia es el martes siguiente (4 dias)
    const now = new Date("2026-07-10T12:00:00.000Z")
    expect(estimateAutoPublishDrainDays(1, [2, 4], 1, now)).toBe(4)
  })

  it("con mas de un item por corrida, agota la cola en menos dias", () => {
    // 3 piezas, 3 por corrida: alcanza con 1 corrida (el martes siguiente, 4 dias)
    const now = new Date("2026-07-10T12:00:00.000Z")
    expect(estimateAutoPublishDrainDays(3, [2, 4], 3, now)).toBe(4)
  })
})

describe("estimateAutoPublishDateForPosition", () => {
  it("null si no hay ningun dia elegido", () => {
    expect(estimateAutoPublishDateForPosition(1, [], 1, new Date("2026-07-10T12:00:00.000Z"))).toBeNull()
  })

  it("la primera posicion sale en la primera corrida programada", () => {
    const now = new Date("2026-07-10T12:00:00.000Z") // viernes
    const result = estimateAutoPublishDateForPosition(1, [2, 4], 1, now)
    expect(result?.getDay()).toBe(2) // martes siguiente
  })

  it("con items_per_run > 1, varias posiciones caen en la misma corrida", () => {
    const now = new Date("2026-07-10T12:00:00.000Z")
    const first = estimateAutoPublishDateForPosition(1, [2], 3, now)
    const third = estimateAutoPublishDateForPosition(3, [2], 3, now)
    expect(first?.toDateString()).toBe(third?.toDateString())
  })

  it("la posicion 4 con items_per_run=3 cae en la segunda corrida", () => {
    const now = new Date("2026-07-10T12:00:00.000Z")
    const third = estimateAutoPublishDateForPosition(3, [2], 3, now)
    const fourth = estimateAutoPublishDateForPosition(4, [2], 3, now)
    expect(fourth?.getTime()).toBeGreaterThan(third?.getTime() ?? 0)
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

  it("una pieza con queue_rank explicito se elige antes que una sin reordenar, aunque sea mas nueva", () => {
    const vieja = item({ id: "vieja", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const reordenada = item({ id: "reordenada", format: "historia", approved_at: "2026-07-05T00:00:00.000Z", queue_rank: 1 })
    expect(pickNextPublishableItem([vieja, reordenada], "historia")?.id).toBe("reordenada")
  })
})

describe("pickNextPublishableItems", () => {
  it("devuelve hasta N piezas aprobadas del formato pedido, en orden de cola", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const c = item({ id: "c", format: "historia", approved_at: "2026-07-03T00:00:00.000Z" })
    expect(pickNextPublishableItems([c, a, b], "historia", 2).map(i => i.id)).toEqual(["a", "b"])
  })

  it("devuelve menos de N si no hay suficientes aprobadas", () => {
    const a = item({ id: "a", format: "historia" })
    expect(pickNextPublishableItems([a], "historia", 3)).toHaveLength(1)
  })

  it("array vacio si count es 0", () => {
    const a = item({ id: "a", format: "historia" })
    expect(pickNextPublishableItems([a], "historia", 0)).toEqual([])
  })

  it("prioriza aprobadas frescas sobre evergreens vencidas, y llena lo que sobra con evergreens", () => {
    const fresh = item({ id: "fresh", format: "historia", status: "approved", approved_at: "2026-07-01T00:00:00.000Z" })
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z",
    })
    const now = new Date("2026-07-10T00:00:00.000Z") // 9 dias despues, ya vencio el intervalo de 7
    expect(pickNextPublishableItems([evergreen, fresh], "historia", 1, now).map(i => i.id)).toEqual(["fresh"])
    expect(pickNextPublishableItems([evergreen, fresh], "historia", 2, now).map(i => i.id)).toEqual(["fresh", "evergreen"])
  })

  it("no repite una evergreen si todavia no paso su intervalo", () => {
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z",
    })
    const now = new Date("2026-07-05T00:00:00.000Z") // solo 4 dias despues
    expect(pickNextPublishableItems([evergreen], "historia", 1, now)).toEqual([])
  })
})

describe("isRepeatDue", () => {
  it("false si el item no tiene repeat_interval_days", () => {
    const a = item({ status: "published", updated_at: "2026-01-01T00:00:00.000Z" })
    expect(isRepeatDue(a, new Date("2026-07-01T00:00:00.000Z"))).toBe(false)
  })

  it("false si el item no esta publicado (ej. sigue aprobada o en borrador)", () => {
    const a = item({ status: "approved", repeat_interval_days: 1, updated_at: "2026-01-01T00:00:00.000Z" })
    expect(isRepeatDue(a, new Date("2026-07-01T00:00:00.000Z"))).toBe(false)
  })

  it("false si todavia no paso el intervalo desde la ultima publicacion", () => {
    const a = item({ status: "published", repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z" })
    expect(isRepeatDue(a, new Date("2026-07-05T00:00:00.000Z"))).toBe(false)
  })

  it("true si ya paso el intervalo desde la ultima publicacion", () => {
    const a = item({ status: "published", repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z" })
    expect(isRepeatDue(a, new Date("2026-07-10T00:00:00.000Z"))).toBe(true)
  })
})

describe("moveItemInQueue", () => {
  it("no hace nada si la pieza ya esta primera y se pide subir", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const original = [a, b]
    const result = moveItemInQueue(original, "a", "up")
    expect(result).toBe(original)
  })

  it("no hace nada si la pieza ya esta ultima y se pide bajar", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const result = moveItemInQueue([a, b], "b", "down")
    expect(pickNextPublishableItems(result, "historia", 2).map(i => i.id)).toEqual(["a", "b"])
  })

  it("sube una pieza un lugar, intercambiando con la de arriba", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const c = item({ id: "c", format: "historia", approved_at: "2026-07-03T00:00:00.000Z" })
    const result = moveItemInQueue([a, b, c], "c", "up")
    expect(pickNextPublishableItems(result, "historia", 3).map(i => i.id)).toEqual(["a", "c", "b"])
  })

  it("no mezcla la cola de posts con la de historias al reordenar", () => {
    const post = item({ id: "post", format: "post", approved_at: "2026-07-01T00:00:00.000Z" })
    const h1 = item({ id: "h1", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const h2 = item({ id: "h2", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const result = moveItemInQueue([post, h1, h2], "h2", "up")
    expect(pickNextPublishableItems(result, "historia", 2).map(i => i.id)).toEqual(["h2", "h1"])
    expect(pickNextPublishableItems(result, "post", 1).map(i => i.id)).toEqual(["post"])
  })

  it("ignora piezas que no estan aprobadas", () => {
    const draft = item({ id: "draft", format: "historia", status: "draft" })
    expect(moveItemInQueue([draft], "draft", "up")).toEqual([draft])
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
