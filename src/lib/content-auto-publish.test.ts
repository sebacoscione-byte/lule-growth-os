import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getPublishReadinessIssue,
  runAutoPublishFormats,
  runAutoPublishTrack,
  shouldSkipCompletedTrack,
} from "@/lib/content-auto-publish"
import * as contentPipeline from "@/lib/content-pipeline"
import { DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
import * as contentPublish from "@/lib/content-publish"
import type { ContentItem } from "@/types"

jest.mock("@/lib/content-pipeline", () => ({
  ...jest.requireActual("@/lib/content-pipeline"),
  readAutoPublishSettings: jest.fn(),
  readContentItems: jest.fn(),
  mutateContentItems: jest.fn(),
  writeAutoPublishSettings: jest.fn(),
}))
jest.mock("@/lib/content-publish", () => ({
  ...jest.requireActual("@/lib/content-publish"),
  publishApprovedItem: jest.fn(),
}))

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

  afterEach(() => {
    jest.clearAllMocks()
  })

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

  it("permite recuperar en el mismo día una corrida parcial que terminó con error", () => {
    const track = {
      ...DEFAULT_AUTO_PUBLISH_SETTINGS.post,
      enabled: true,
      last_published_at: "2026-08-06T22:05:00.000Z",
      last_run_result: "published:1/2 (error: Meta temporalmente no disponible)",
    }
    expect(shouldSkipCompletedTrack(track, new Date("2026-08-06T22:40:00.000Z"))).toBe(false)
  })

  it("propaga un fallo de canal al resultado que lee el ledger del cron", async () => {
    const candidate = item({ visual_url: "https://example.com/plate.jpg" })
    ;(contentPipeline.readContentItems as jest.Mock).mockResolvedValue([candidate])
    ;(contentPipeline.mutateContentItems as jest.Mock).mockResolvedValue([candidate])
    ;(contentPublish.publishApprovedItem as jest.Mock).mockResolvedValue({
      item: {
        ...candidate,
        auto_publish_result: { instagram: "error" },
        auto_publish_errors: { instagram: "Meta temporalmente no disponible" },
      },
      allPublished: false,
      errors: { instagram: "Meta temporalmente no disponible" },
    })

    const track = { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, enabled: true }
    const result = await runAutoPublishTrack(
      supabase,
      "post",
      track,
      ["instagram"],
      new Date("2026-08-06T22:15:00.000Z")
    )

    expect(result.last_run_result).toBe(
      "published:0/1 (error: item item-1: instagram: Meta temporalmente no disponible)"
    )
    expect(shouldSkipCompletedTrack(result, new Date("2026-08-06T22:40:00.000Z"))).toBe(false)
  })

  it("publica las historias nuevas antes que las repeticiones en la corrida real", async () => {
    const fresh = item({
      id: "fresh-story", format: "historia", visual_url: "https://example.com/fresh.jpg", queue_rank: 2,
      hook: "Historia nueva", caption: "Contenido nuevo",
    })
    const repeat = item({
      id: "repeat-story", format: "historia", status: "published",
      visual_url: "https://example.com/repeat.jpg", repeat_interval_days: 1, queue_rank: 1,
      updated_at: "2026-08-01T21:15:00.000Z", hook: "Historia evergreen", caption: "Contenido repetido",
    })
    ;(contentPipeline.readContentItems as jest.Mock).mockResolvedValue([repeat, fresh])
    ;(contentPipeline.mutateContentItems as jest.Mock).mockResolvedValue([repeat, fresh])
    ;(contentPublish.publishApprovedItem as jest.Mock).mockImplementation(async (_supabase, candidate) => ({
      item: { ...candidate, status: "published" },
      allPublished: true,
      errors: {},
    }))

    const track = {
      ...DEFAULT_AUTO_PUBLISH_SETTINGS.historia,
      enabled: true,
      items_per_run: 1,
      schedule_slots: [{ day_of_week: 4, local_time: "18:00" }],
    }
    const result = await runAutoPublishTrack(
      supabase,
      "historia",
      track,
      ["instagram"],
      new Date("2026-08-06T21:15:00.000Z")
    )

    expect((contentPublish.publishApprovedItem as jest.Mock).mock.calls.map(call => call[1].id))
      .toEqual(["fresh-story", "repeat-story"])
    expect(result.last_run_result).toBe("published:2/2")
  })
})

describe("runAutoPublishFormats", () => {
  const supabase = {} as SupabaseClient

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("publica post y reel en secuencia cuando comparten la misma noche", async () => {
    const post = item({ id: "post-1", visual_url: "https://example.com/post.jpg" })
    const reel = item({ id: "reel-1", format: "reel", video_url: "https://example.com/reel.mp4" })
    const settings = structuredClone(DEFAULT_AUTO_PUBLISH_SETTINGS)
    settings.post = {
      ...settings.post,
      enabled: true,
      schedule_slots: [{ day_of_week: 4, local_time: "19:00" }],
    }
    settings.reel = {
      ...settings.reel,
      enabled: true,
      schedule_slots: [{ day_of_week: 4, local_time: "19:00" }],
    }

    ;(contentPipeline.readAutoPublishSettings as jest.Mock).mockResolvedValue(settings)
    ;(contentPipeline.readContentItems as jest.Mock).mockResolvedValue([post, reel])
    ;(contentPipeline.mutateContentItems as jest.Mock).mockResolvedValue([post, reel])
    ;(contentPublish.publishApprovedItem as jest.Mock).mockImplementation(async (_supabase, candidate) => ({
      item: { ...candidate, status: "published" },
      allPublished: true,
      errors: {},
    }))

    const results = await runAutoPublishFormats(
      supabase,
      ["post", "reel"],
      new Date("2026-08-06T22:15:00.000Z")
    )

    expect(contentPublish.publishApprovedItem).toHaveBeenCalledTimes(2)
    expect((contentPublish.publishApprovedItem as jest.Mock).mock.calls.map(call => call[1].id))
      .toEqual(["post-1", "reel-1"])
    expect(results.post?.last_run_result).toBe("published:1/1")
    expect(results.reel?.last_run_result).toBe("published:1/1")
    expect(contentPipeline.writeAutoPublishSettings).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        post: expect.objectContaining({ last_run_result: "published:1/1" }),
        reel: expect.objectContaining({ last_run_result: "published:1/1" }),
      })
    )
  })
})
