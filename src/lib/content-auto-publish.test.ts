import type { SupabaseClient } from "@supabase/supabase-js"
import { getPublishReadinessIssue, runAutoPublishTrack } from "@/lib/content-auto-publish"
import { DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
import type { ContentItem } from "@/types"

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    topic: "Tema",
    category: "Educación",
    format: "post",
    goal: "",
    status: "approved",
    channels: ["instagram"],
    hook: "hook",
    caption: "caption",
    google_text: "google",
    hashtags: "#tag",
    visual_headline: "Título",
    visual_subtitle: "Subtítulo",
    visual_style: "rose",
    source: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    approved_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("getPublishReadinessIssue", () => {
  it("bloquea un carrusel incompleto", () => {
    const carrusel = item({
      format: "carrusel",
      visual_url: "https://example.com/cover.jpg",
      slides: [{ headline: "Slide", text: "Texto" }],
    })
    expect(getPublishReadinessIssue(carrusel, "carrusel")).toContain("sin todas las placas")
  })

  it("bloquea un reel sin video", () => {
    expect(getPublishReadinessIssue(item({ format: "reel" }), "reel")).toContain("sin video")
  })

  it("acepta un reel con video y un carrusel completo", () => {
    expect(getPublishReadinessIssue(item({ format: "reel", video_url: "https://example.com/reel.mp4" }), "reel")).toBeNull()
    expect(getPublishReadinessIssue(item({
      format: "carrusel",
      visual_url: "https://example.com/cover.jpg",
      slides: [{ headline: "Slide", text: "Texto", visual_url: "https://example.com/slide.jpg" }],
    }), "carrusel")).toBeNull()
  })
})

describe("runAutoPublishTrack scheduling guards", () => {
  const supabase = {} as SupabaseClient

  it("no toca la cola fuera de la ventana local", async () => {
    const track = { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, enabled: true }
    const result = await runAutoPublishTrack(supabase, "post", track, ["instagram"], new Date("2026-08-06T21:30:00.000Z"))
    expect(result.last_run_result).toBe("skipped_outside_window")
  })

  it("un retry en el mismo día argentino no vuelve a publicar", async () => {
    const track = {
      ...DEFAULT_AUTO_PUBLISH_SETTINGS.post,
      enabled: true,
      last_published_at: "2026-08-06T22:05:00.000Z",
    }
    const result = await runAutoPublishTrack(supabase, "post", track, ["instagram"], new Date("2026-08-06T22:40:00.000Z"))
    expect(result.last_run_result).toBe("skipped_already_published")
  })
})
