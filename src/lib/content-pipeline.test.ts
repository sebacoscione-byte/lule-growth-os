import {
  shouldRunAutoPublish, isScheduledForFuture, isTodayScheduledDay, alreadyPublishedToday,
  estimateAutoPublishDrainDays, estimateAutoPublishDateForPosition, pickNextPublishableItem,
  pickNextPublishableItems, moveItemInQueue, resolveChannelsToPublish, DEFAULT_AUTO_PUBLISH_SETTINGS,
  isRepeatDue, findRecentDuplicateTopic, estimateRepeatEndDate, isReorderableInQueue,
  reorderableQueuePositions, autoPublishSettingsSchema, getZonedScheduleParts,
  isWithinScheduledWindow, normalizeAutoPublishSettings, buildDraftContentItem, contentPublicationSignature,
} from "@/lib/content-pipeline"
import { MAX_VISUAL_SUBTITLE_LENGTH } from "@/lib/content-text"
import type { AutoPublishTrackSettings, ContentItem } from "@/types"

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  const id = overrides.id ?? "1"
  return {
    id,
    topic: "Tema",
    category: "Categoria",
    format: "post",
    goal: "",
    status: "approved",
    channels: ["instagram", "google_business"],
    hook: `hook ${id}`,
    caption: `caption ${id}`,
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

function slots(days: number[], localTime = "19:00") {
  return days.map(day => ({ day_of_week: day, local_time: localTime }))
}

describe("shouldRunAutoPublish", () => {
  // 2026-07-10 = viernes (5), 2026-07-07 = martes (2), 2026-07-15 = miercoles (3)
  it("no corre si esta deshabilitado", () => {
    expect(shouldRunAutoPublish(track({ enabled: false, schedule_slots: slots([5]) }), new Date("2026-07-10T22:30:00.000Z"))).toBe(false)
  })

  it("no corre si no eligio ningun dia de la semana", () => {
    const now = new Date("2026-07-10T22:30:00.000Z")
    expect(shouldRunAutoPublish(track({ enabled: true, schedule_slots: [] }), now)).toBe(false)
  })

  it("no corre si hoy no es uno de los dias elegidos", () => {
    const now = new Date("2026-07-10T22:30:00.000Z") // viernes 19:30 ART
    const t = track({ enabled: true, schedule_slots: slots([2]) }) // solo martes
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre si hoy es uno de los dias elegidos y nunca publico antes", () => {
    const now = new Date("2026-07-10T22:30:00.000Z") // viernes 19:30 ART
    const t = track({ enabled: true, schedule_slots: slots([5]), last_published_at: null })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("no corre si ya publico hoy mismo (evita duplicar si el cron corre dos veces)", () => {
    const now = new Date("2026-07-10T22:30:00.000Z") // viernes 19:30 ART
    const t = track({ enabled: true, schedule_slots: slots([5]), last_published_at: "2026-07-10T22:05:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre si hoy es un dia elegido pero la ultima publicacion fue otro dia", () => {
    const now = new Date("2026-07-10T22:30:00.000Z") // viernes
    const t = track({ enabled: true, schedule_slots: slots([2, 5]), last_published_at: "2026-07-07T22:00:00.000Z" }) // martes
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("no corre si tiene una fecha de inicio programada que todavia no llego, aunque hoy sea un dia elegido", () => {
    const now = new Date("2026-07-10T22:30:00.000Z") // viernes
    const t = track({ enabled: true, schedule_slots: slots([5]), last_published_at: null, starts_at: "2026-07-15T00:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre una vez que se cumple la fecha de inicio programada, si ademas hoy es un dia elegido", () => {
    const now = new Date("2026-07-15T22:30:00.000Z") // miercoles 19:30 ART
    const t = track({ enabled: true, schedule_slots: slots([3]), last_published_at: null, starts_at: "2026-07-15T00:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("no corre fuera de la ventana horaria aunque sea el día correcto", () => {
    const t = track({ enabled: true, schedule_slots: slots([5]) })
    expect(shouldRunAutoPublish(t, new Date("2026-07-10T21:59:59.000Z"))).toBe(false)
    expect(shouldRunAutoPublish(t, new Date("2026-07-10T23:00:00.000Z"))).toBe(false)
  })
})

describe("isTodayScheduledDay", () => {
  it("true si el dia de now esta en days_of_week", () => {
    const now = new Date("2026-07-10T09:00:00.000Z") // viernes = 5
    expect(isTodayScheduledDay(track({ schedule_slots: slots([2, 5]) }), now)).toBe(true)
  })

  it("false si el dia de now no esta en days_of_week", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    expect(isTodayScheduledDay(track({ schedule_slots: slots([2]) }), now)).toBe(false)
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

  it("usa el día argentino al cruzar medianoche UTC", () => {
    const now = new Date("2026-07-11T01:30:00.000Z") // viernes 10, 22:30 ART
    const t = track({ last_published_at: "2026-07-10T22:15:00.000Z" }) // viernes 10, 19:15 ART
    expect(alreadyPublishedToday(t, now)).toBe(true)
  })
})

describe("zona horaria y ventanas editoriales", () => {
  it("convierte UTC a America/Argentina/Buenos_Aires sin cambiar mal el día", () => {
    expect(getZonedScheduleParts(new Date("2026-08-04T02:30:00.000Z"))).toEqual({
      dateKey: "2026-08-03",
      dayOfWeek: 1,
      hour: 23,
      minute: 30,
    })
  })

  it("reconoce toda la ventana 19:00-19:59 ART y no las horas contiguas", () => {
    const t = track({ schedule_slots: slots([2]) })
    expect(isWithinScheduledWindow(t, new Date("2026-08-04T22:00:00.000Z"))).toBe(true)
    expect(isWithinScheduledWindow(t, new Date("2026-08-04T22:59:59.000Z"))).toBe(true)
    expect(isWithinScheduledWindow(t, new Date("2026-08-04T21:59:59.000Z"))).toBe(false)
    expect(isWithinScheduledWindow(t, new Date("2026-08-04T23:00:00.000Z"))).toBe(false)
  })
})

describe("configuración de slots", () => {
  it("migra days_of_week legacy al horario real del formato y conserva estado operativo", () => {
    const migrated = normalizeAutoPublishSettings({
      channels: ["instagram"],
      post: {
        enabled: true,
        times_per_week: 2,
        days_of_week: [2, 4],
        items_per_run: 1,
        starts_at: null,
        last_published_at: "2026-08-01T22:10:00.000Z",
        last_run_at: "2026-08-01T22:10:00.000Z",
        last_run_result: "published:1/1",
      },
      historia: { enabled: false, times_per_week: 1, days_of_week: [1], items_per_run: 3 },
    })

    expect(migrated.post.schedule_slots).toEqual(slots([2, 4]))
    expect(migrated.post.last_run_result).toBe("published:1/1")
    expect(migrated.historia.schedule_slots).toEqual(slots([1], "18:00"))
    expect(migrated.historia.items_per_run).toBe(3)
  })

  it("rechaza slots duplicados", () => {
    const settings = structuredClone(DEFAULT_AUTO_PUBLISH_SETTINGS)
    settings.post.schedule_slots = slots([4, 4])
    expect(autoPublishSettingsSchema.safeParse(settings).success).toBe(false)
  })

  it("rechaza dos formatos principales activos la misma noche", () => {
    const settings = structuredClone(DEFAULT_AUTO_PUBLISH_SETTINGS)
    settings.post.enabled = true
    settings.carrusel.enabled = true
    settings.post.schedule_slots = slots([4])
    settings.carrusel.schedule_slots = slots([4])
    expect(autoPublishSettingsSchema.safeParse(settings).success).toBe(false)
  })

  it("rechaza una hora que el cron desplegado no puede cumplir", () => {
    const settings = structuredClone(DEFAULT_AUTO_PUBLISH_SETTINGS)
    settings.reel.schedule_slots = slots([6], "20:00")
    expect(autoPublishSettingsSchema.safeParse(settings).success).toBe(false)
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

  it("si hoy es un dia elegido y todavia esta disponible, cuenta como el dia 0 (no lo salta)", () => {
    // jueves 2026-07-09, eligiendo martes(2) y jueves(4): hoy mismo es la 1ra ocurrencia
    const now = new Date("2026-07-09T12:00:00.000Z")
    expect(estimateAutoPublishDrainDays(1, [2, 4], 1, now, true)).toBe(0)
  })

  it("si hoy ya no esta disponible (ya publico, o todavia no arranca), lo salta igual que antes", () => {
    const now = new Date("2026-07-09T12:00:00.000Z")
    expect(estimateAutoPublishDrainDays(1, [2, 4], 1, now, false)).toBe(5) // el martes siguiente
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

  it("si hoy es un dia elegido y todavia esta disponible, la posicion 1 sale hoy (no la salta)", () => {
    // jueves 2026-07-09, eligiendo martes(2) y jueves(4)
    const now = new Date("2026-07-09T12:00:00.000Z")
    const result = estimateAutoPublishDateForPosition(1, [2, 4], 1, now, true)
    expect(result?.toDateString()).toBe(now.toDateString())
  })

  it("si hoy ya no esta disponible, la posicion 1 salta al proximo dia elegido igual que antes", () => {
    const now = new Date("2026-07-09T12:00:00.000Z")
    const result = estimateAutoPublishDateForPosition(1, [2, 4], 1, now, false)
    expect(result?.getDay()).toBe(2) // martes siguiente
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

  it("ignora reels y carruseles al pedir el formato post (cada uno tiene su propio track)", () => {
    const reel = item({ id: "reel", format: "reel" })
    const carrusel = item({ id: "carrusel", format: "carrusel" })
    expect(pickNextPublishableItem([reel, carrusel], "post")).toBeNull()
  })

  it("un carrusel aprobado se elige al pedir el formato carrusel", () => {
    const carrusel = item({ id: "carrusel", format: "carrusel" })
    expect(pickNextPublishableItem([carrusel], "carrusel")?.id).toBe("carrusel")
  })

  it("un reel aprobado se elige al pedir el formato reel (tiene su propio track, 2026-07-23), pero no en los otros", () => {
    const reel = item({ id: "reel", format: "reel", video_url: "https://example.com/reel.mp4" })
    expect(pickNextPublishableItem([reel], "reel")?.id).toBe("reel")
    expect(pickNextPublishableItem([reel], "post")).toBeNull()
    expect(pickNextPublishableItem([reel], "historia")).toBeNull()
    expect(pickNextPublishableItem([reel], "carrusel")).toBeNull()
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

  it("no publica dos historias con hook y caption idénticos en la misma corrida", () => {
    const first = item({
      id: "first", format: "historia", hook: "¿Ya pediste turno?", caption: "Consultá por la sede.",
      approved_at: "2026-07-01T00:00:00.000Z",
    })
    const duplicate = item({
      id: "duplicate", format: "historia", hook: "  ¿YA PEDISTE   TURNO? ", caption: "consultá por la sede.",
      approved_at: "2026-07-02T00:00:00.000Z",
    })
    const distinct = item({
      id: "distinct", format: "historia", hook: "Conocé las sedes", caption: "Lanús, CABA y Lomas.",
      approved_at: "2026-07-03T00:00:00.000Z",
    })

    expect(pickNextPublishableItems([first, duplicate, distinct], "historia", 3).map(i => i.id))
      .toEqual(["first", "distinct"])
  })

  it("array vacio si count es 0", () => {
    const a = item({ id: "a", format: "historia" })
    expect(pickNextPublishableItems([a], "historia", 0)).toEqual([])
  })

  it("las evergreens vencidas se publican ADEMAS de las frescas, sin competir por el cupo", () => {
    const fresh = item({ id: "fresh", format: "historia", status: "approved", approved_at: "2026-07-01T00:00:00.000Z" })
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z",
    })
    const now = new Date("2026-07-10T00:00:00.000Z") // 9 dias despues, ya vencio el intervalo de 7
    // Con cupo 1 salen las DOS: la fresca (dentro del cupo) y ademas la evergreen vencida (2 publicaciones).
    expect(pickNextPublishableItems([evergreen, fresh], "historia", 1, now).map(i => i.id)).toEqual(["fresh", "evergreen"])
  })

  it("items_per_run limita solo las frescas; las evergreens se agregan aparte", () => {
    const fresh1 = item({ id: "fresh1", format: "historia", status: "approved", approved_at: "2026-07-01T00:00:00.000Z" })
    const fresh2 = item({ id: "fresh2", format: "historia", status: "approved", approved_at: "2026-07-02T00:00:00.000Z" })
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 7, updated_at: "2026-07-01T00:00:00.000Z",
    })
    const now = new Date("2026-07-10T00:00:00.000Z")
    // Cupo 1: solo la primera fresca (la mas antigua) + la evergreen. fresh2 espera a la proxima corrida.
    expect(pickNextPublishableItems([evergreen, fresh1, fresh2], "historia", 1, now).map(i => i.id)).toEqual(["fresh1", "evergreen"])
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

describe("contentPublicationSignature", () => {
  it("normaliza solo diferencias irrelevantes de mayúsculas y espacios", () => {
    const a = item({ id: "a", hook: "Mismo  hook", caption: "Mismo texto" })
    const b = item({ id: "b", hook: " mismo HOOK ", caption: "mismo   texto" })
    expect(contentPublicationSignature(a)).toBe(contentPublicationSignature(b))
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

  it("con repeat_interval_days=1 (interruptor on/off) es elegible en cuanto pasa un dia", () => {
    const a = item({ status: "published", repeat_interval_days: 1, updated_at: "2026-07-01T00:00:00.000Z" })
    expect(isRepeatDue(a, new Date("2026-07-03T00:00:00.000Z"))).toBe(true)
  })

  it("false si ya alcanzo el limite de repeticiones aunque haya vencido el intervalo", () => {
    const a = item({
      status: "published", repeat_interval_days: 1, repeat_limit: 8, repeat_count: 8,
      updated_at: "2026-07-01T00:00:00.000Z",
    })
    expect(isRepeatDue(a, new Date("2026-07-10T00:00:00.000Z"))).toBe(false)
  })

  it("true si todavia no alcanzo el limite de repeticiones", () => {
    const a = item({
      status: "published", repeat_interval_days: 1, repeat_limit: 8, repeat_count: 3,
      updated_at: "2026-07-01T00:00:00.000Z",
    })
    expect(isRepeatDue(a, new Date("2026-07-10T00:00:00.000Z"))).toBe(true)
  })

  it("sin repeat_limit no hay tope: se repite aunque repeat_count sea alto", () => {
    const a = item({
      status: "published", repeat_interval_days: 1, repeat_count: 50,
      updated_at: "2026-07-01T00:00:00.000Z",
    })
    expect(isRepeatDue(a, new Date("2026-07-10T00:00:00.000Z"))).toBe(true)
  })

  // Bug real 2026-08-11: dos historias con repeat_interval_days=1 no se publicaron en su corrida
  // programada. Causa: un intento de republicar fallido (o una edicion manual) toco `updated_at` mas
  // tarde de lo habitual la noche anterior (22:49 ART, fuera de la ventana normal 18:00-18:59), y la
  // corrida del dia siguiente (18:29 ART) cayo a solo ~19.7hs de esa marca -- menos de 24hs exactas,
  // aunque la fecha civil ya habia cambiado. Comparar por dia civil (ART) en vez de horas exactas es
  // el fix: ver `zonedCalendarDaysBetween`.
  it("true al dia civil siguiente aunque el ultimo touch haya sido tarde a la noche (menos de 24hs exactas)", () => {
    const a = item({
      status: "published", repeat_interval_days: 1,
      updated_at: "2026-08-11T01:49:06.001Z", // 2026-08-10 22:49 ART
    })
    // 2026-08-11T21:29:59Z = 2026-08-11 18:29 ART -- ~19.7hs reales despues, pero ya es el dia civil
    // siguiente en ART.
    expect(isRepeatDue(a, new Date("2026-08-11T21:29:59.048Z"))).toBe(true)
  })

  it("false todavia dentro del mismo dia civil (ART), aunque hayan pasado varias horas", () => {
    const a = item({
      status: "published", repeat_interval_days: 1,
      updated_at: "2026-08-10T13:00:00.000Z", // 2026-08-10 10:00 ART
    })
    // 2026-08-10T21:34:16Z = 2026-08-10 18:34 ART -- mismo dia civil que el ultimo touch.
    expect(isRepeatDue(a, new Date("2026-08-10T21:34:16.000Z"))).toBe(false)
  })
})

describe("estimateRepeatEndDate", () => {
  const now = new Date("2026-07-10T12:00:00.000Z") // viernes
  const daysBetween = (end: Date | null) => (end == null ? null : Math.round((end.getTime() - now.getTime()) / 86400000))

  it("null si la pieza no se repite", () => {
    expect(estimateRepeatEndDate(item({ repeat_limit: 5 }), [2, 4], now)).toBeNull()
  })

  it("null si no tiene limite (se repite hasta apagarla)", () => {
    expect(estimateRepeatEndDate(item({ repeat_interval_days: 1 }), [2, 4], now)).toBeNull()
  })

  it("aprobada sin publicar: cuenta la publicacion original + las repeticiones", () => {
    // total = 1 + 1 = 2 apariciones; la 2da en el cronograma martes/jueves desde el viernes cae +6 dias
    const a = item({ status: "approved", repeat_interval_days: 1, repeat_limit: 1, repeat_count: 0 })
    expect(daysBetween(estimateRepeatEndDate(a, [2, 4], now))).toBe(6)
  })

  it("ya publicada y repitiendo: descuenta la original + las repeticiones ya hechas", () => {
    // total 1+3=4; ya aparecio 1 (original) + 2 (repeat_count) = 3; queda 1 -> proxima ocurrencia (martes, +4)
    const a = item({ status: "published", repeat_interval_days: 1, repeat_limit: 3, repeat_count: 2 })
    expect(daysBetween(estimateRepeatEndDate(a, [2, 4], now))).toBe(4)
  })

  it("null si ya alcanzo el limite (no quedan repeticiones)", () => {
    const a = item({ status: "published", repeat_interval_days: 1, repeat_limit: 3, repeat_count: 3 })
    expect(estimateRepeatEndDate(a, [2, 4], now)).toBeNull()
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

  it("ignora piezas que no estan aprobadas ni son evergreens activas", () => {
    const draft = item({ id: "draft", format: "historia", status: "draft" })
    expect(moveItemInQueue([draft], "draft", "up")).toEqual([draft])
  })

  it("una evergreen que sigue repitiendose se puede intercalar entre piezas aprobadas nuevas", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 1, updated_at: "2026-06-01T00:00:00.000Z",
    })
    // Orden efectivo de arranque (sin reordenar nunca): a, b, evergreen (la evergreen cae al final por
    // default, ver REPEAT_DEFAULT_RANK_OFFSET). Subirla dos veces la deja primera.
    const now = new Date("2026-07-10T00:00:00.000Z")
    const once = moveItemInQueue([a, b, evergreen], "evergreen", "up")
    expect(pickNextPublishableItems(once, "historia", 2, now).map(i => i.id)).toEqual(["a", "evergreen", "b"])
    const twice = moveItemInQueue(once, "evergreen", "up")
    expect(pickNextPublishableItems(twice, "historia", 2, now).map(i => i.id)).toEqual(["evergreen", "a", "b"])
  })

  it("no reordena una evergreen que ya agoto su limite de repeticiones", () => {
    const a = item({ id: "a", format: "historia" })
    const exhausted = item({
      id: "exhausted", format: "historia", status: "published",
      repeat_interval_days: 1, repeat_limit: 2, repeat_count: 2, updated_at: "2026-06-01T00:00:00.000Z",
    })
    expect(moveItemInQueue([a, exhausted], "exhausted", "up")).toEqual([a, exhausted])
  })
})

describe("isReorderableInQueue", () => {
  it("true para una pieza aprobada", () => {
    expect(isReorderableInQueue(item({ status: "approved" }))).toBe(true)
  })

  it("true para una evergreen publicada sin limite de repeticiones", () => {
    expect(isReorderableInQueue(item({ status: "published", repeat_interval_days: 1 }))).toBe(true)
  })

  it("true para una evergreen publicada con limite todavia no alcanzado", () => {
    expect(isReorderableInQueue(item({
      status: "published", repeat_interval_days: 1, repeat_limit: 5, repeat_count: 3,
    }))).toBe(true)
  })

  it("false para una evergreen que ya agoto su limite de repeticiones", () => {
    expect(isReorderableInQueue(item({
      status: "published", repeat_interval_days: 1, repeat_limit: 2, repeat_count: 2,
    }))).toBe(false)
  })

  it("false para una pieza publicada que no se repite", () => {
    expect(isReorderableInQueue(item({ status: "published" }))).toBe(false)
  })

  it("false para un borrador", () => {
    expect(isReorderableInQueue(item({ status: "draft" }))).toBe(false)
  })
})

describe("reorderableQueuePositions", () => {
  it("ordena aprobadas y evergreens activas juntas, por formato", () => {
    const a = item({ id: "a", format: "historia", approved_at: "2026-07-01T00:00:00.000Z" })
    const b = item({ id: "b", format: "historia", approved_at: "2026-07-02T00:00:00.000Z" })
    const evergreen = item({
      id: "evergreen", format: "historia", status: "published",
      repeat_interval_days: 1, updated_at: "2026-06-01T00:00:00.000Z",
    })
    const post = item({ id: "post", format: "post" })
    const positions = reorderableQueuePositions([a, b, evergreen, post], "historia")
    expect(positions.get("a")).toBe(1)
    expect(positions.get("b")).toBe(2)
    expect(positions.get("evergreen")).toBe(3)
    expect(positions.has("post")).toBe(false)
  })
})

describe("findRecentDuplicateTopic", () => {
  it("null si no hay ninguna pieza con la misma categoria ni el mismo hook", () => {
    const a = item({ id: "a", category: "Colesterol", hook: "hook a", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([a], { category: "Presion arterial", hook: "otro hook" }, now)).toBeNull()
  })

  it("encuentra la pieza mas reciente con la misma categoria dentro de la ventana", () => {
    const vieja = item({ id: "vieja", category: "Colesterol", created_at: "2026-06-01T00:00:00.000Z" })
    const nueva = item({ id: "nueva", category: "Colesterol", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([vieja, nueva], { category: "Colesterol" }, now)?.id).toBe("nueva")
  })

  it("ignora piezas fuera de la ventana de dias (default 15)", () => {
    const vieja = item({ id: "vieja", category: "Colesterol", created_at: "2026-06-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([vieja], { category: "Colesterol" }, now)).toBeNull()
  })

  it("ignora piezas archivadas", () => {
    const archivada = item({ id: "archivada", category: "Colesterol", status: "archived", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([archivada], { category: "Colesterol" }, now)).toBeNull()
  })

  it("ignora borradores: todavia pueden descartarse o cambiar de tema", () => {
    const borrador = item({ id: "borrador", category: "Colesterol", status: "draft", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([borrador], { category: "Colesterol" }, now)).toBeNull()
  })

  it("detecta piezas publicadas dentro de la ventana, no solo aprobadas", () => {
    const publicada = item({ id: "publicada", category: "Colesterol", status: "published", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([publicada], { category: "Colesterol" }, now)?.id).toBe("publicada")
  })

  it("ignora la propia pieza cuando se pasa su id (editando una pieza existente)", () => {
    const propia = item({ id: "propia", category: "Colesterol", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([propia], { id: "propia", category: "Colesterol" }, now)).toBeNull()
  })

  it("tambien detecta el mismo hook aunque la categoria sea distinta", () => {
    const a = item({ id: "a", category: "Colesterol", hook: "Mismo hook exacto", created_at: "2026-07-01T00:00:00.000Z" })
    const now = new Date("2026-07-05T00:00:00.000Z")
    expect(findRecentDuplicateTopic([a], { category: "Otra categoria", hook: "mismo hook exacto  " }, now)?.id).toBe("a")
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

// 2026-08-06: bug real reportado por Seba tras revisar historias generadas por el auto-draft --
// visual_subtitle se guardaba con un slice(0, 90) ciego, que cortaba a mitad de palabra un subtitulo
// mas largo (ej. "...te ayuda a protegerlo y manten" en vez de "...y mantenerlo"). La regla nueva de
// historias (STORY_VISUAL_TEXT_RULES) pide un dato real concreto, que suele superar 90 caracteres --
// ahora usa truncateForImagePlate (corta en un limite de oracion/palabra, nunca a mitad) con un tope
// mas alto (140, MAX_VISUAL_SUBTITLE_LENGTH).
describe("buildDraftContentItem", () => {
  const generated = {
    hook: "hook", caption: "caption", google_text: "google text", hashtags: "#tag1 #tag2",
    visual_headline: "titulo", visual_subtitle: "subtitulo corto", visual_style: "rose",
  }

  it("no toca un subtitulo que ya entra en el limite", () => {
    const result = buildDraftContentItem({
      generated, topic: "Tema", category: "Categoria", format: "historia", objective: "educacion",
    })
    expect(result.visual_subtitle).toBe("subtitulo corto")
  })

  it("un subtitulo largo se corta en un limite de oracion, nunca a mitad de palabra", () => {
    const longSubtitle = "Significa que trabaja con menos fuerza, no que se detiene por completo, y eso es fundamental entenderlo bien. Un control a tiempo te ayuda a protegerlo y mantenerlo funcionando lo mejor posible por mucho mas tiempo."
    expect(longSubtitle.length).toBeGreaterThan(MAX_VISUAL_SUBTITLE_LENGTH)
    const result = buildDraftContentItem({
      generated: { ...generated, visual_subtitle: longSubtitle },
      topic: "Tema", category: "Categoria", format: "historia", objective: "educacion",
    })
    expect(result.visual_subtitle.length).toBeLessThanOrEqual(MAX_VISUAL_SUBTITLE_LENGTH)
    // Se corta en el punto de la primera oracion completa, no a mitad de una palabra.
    expect(result.visual_subtitle).toBe("Significa que trabaja con menos fuerza, no que se detiene por completo, y eso es fundamental entenderlo bien.")
    expect(longSubtitle.startsWith(result.visual_subtitle)).toBe(true)
  })
})
