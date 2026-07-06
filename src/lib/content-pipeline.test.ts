import { shouldRunAutoPublish, pickNextPublishableItem, resolveChannelsToPublish, DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
import type { AutoPublishSettings, ContentItem } from "@/types"

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

function settings(overrides: Partial<AutoPublishSettings> = {}): AutoPublishSettings {
  return { ...DEFAULT_AUTO_PUBLISH_SETTINGS, ...overrides }
}

describe("shouldRunAutoPublish", () => {
  it("no corre si esta deshabilitado", () => {
    expect(shouldRunAutoPublish(settings({ enabled: false }), new Date())).toBe(false)
  })

  it("corre si nunca publico antes", () => {
    expect(shouldRunAutoPublish(settings({ enabled: true, last_published_at: null }), new Date())).toBe(true)
  })

  it("no corre si todavia no paso el intervalo", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    const s = settings({ enabled: true, interval_days: 3, last_published_at: "2026-07-09T09:00:00.000Z" })
    expect(shouldRunAutoPublish(s, now)).toBe(false)
  })

  it("corre justo al cumplirse el intervalo", () => {
    const now = new Date("2026-07-10T09:00:00.000Z")
    const s = settings({ enabled: true, interval_days: 3, last_published_at: "2026-07-07T09:00:00.000Z" })
    expect(shouldRunAutoPublish(s, now)).toBe(true)
  })
})

describe("pickNextPublishableItem", () => {
  it("devuelve null si no hay aprobados", () => {
    expect(pickNextPublishableItem([item({ status: "draft" })])).toBeNull()
  })

  it("saltea reels y carruseles, quedan pendientes de accion manual", () => {
    const reel = item({ id: "reel", format: "reel" })
    const carrusel = item({ id: "carrusel", format: "carrusel" })
    expect(pickNextPublishableItem([reel, carrusel])).toBeNull()
  })

  it("elige el aprobado publicable mas antiguo por approved_at", () => {
    const viejo = item({ id: "viejo", approved_at: "2026-07-01T00:00:00.000Z" })
    const nuevo = item({ id: "nuevo", approved_at: "2026-07-05T00:00:00.000Z" })
    expect(pickNextPublishableItem([nuevo, viejo])?.id).toBe("viejo")
  })

  it("permite formato historia ademas de post", () => {
    const historia = item({ id: "historia", format: "historia" })
    expect(pickNextPublishableItem([historia])?.id).toBe("historia")
  })
})

describe("resolveChannelsToPublish", () => {
  it("intersecta los canales del item con los habilitados globalmente", () => {
    const result = resolveChannelsToPublish(
      item({ channels: ["instagram", "google_business"] }),
      settings({ channels: ["instagram"] })
    )
    expect(result).toEqual(["instagram"])
  })

  it("devuelve vacio si el item no pide ningun canal habilitado", () => {
    const result = resolveChannelsToPublish(
      item({ channels: ["google_business"] }),
      settings({ channels: ["instagram"] })
    )
    expect(result).toEqual([])
  })
})
