import { shouldRunAutoPublish, pickNextPublishableItem, resolveChannelsToPublish, DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
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
  it("no corre si esta deshabilitado", () => {
    expect(shouldRunAutoPublish(track({ enabled: false }), new Date())).toBe(false)
  })

  it("corre si nunca publico antes", () => {
    expect(shouldRunAutoPublish(track({ enabled: true, last_published_at: null }), new Date())).toBe(true)
  })

  it("no corre si todavia no paso el intervalo (7 / veces_por_semana)", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    // 2 veces por semana = cada 3.5 dias; a 3 dias de la ultima publicacion, todavia no corresponde
    const t = track({ enabled: true, times_per_week: 2, last_published_at: "2026-07-07T09:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(false)
  })

  it("corre al cumplirse el intervalo", () => {
    const now = new Date("2026-07-11T09:00:00.000Z")
    const t = track({ enabled: true, times_per_week: 2, last_published_at: "2026-07-07T09:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
  })

  it("con mas veces por semana, el intervalo requerido es mas corto", () => {
    const now = new Date("2026-07-09T09:00:00.000Z")
    // 7 veces por semana = cada 1 dia
    const t = track({ enabled: true, times_per_week: 7, last_published_at: "2026-07-08T09:00:00.000Z" })
    expect(shouldRunAutoPublish(t, now)).toBe(true)
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
})
