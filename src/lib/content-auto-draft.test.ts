import { planAutoDrafts, runAutoDraftGeneration } from "@/lib/content-auto-draft"
import { generateContentPlan, getAiMode } from "@/lib/ai"
import { readAutoPublishSettings, readContentItems, writeContentItems, DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentItem } from "@/types"

jest.mock("@/lib/ai", () => {
  const actual = jest.requireActual("@/lib/ai")
  return {
    ...actual,
    generateContentPlan: jest.fn(),
    getAiMode: jest.fn(),
  }
})
jest.mock("@/lib/content-pipeline", () => {
  const actual = jest.requireActual("@/lib/content-pipeline")
  return {
    ...actual,
    readContentItems: jest.fn(),
    writeContentItems: jest.fn(),
    readAutoPublishSettings: jest.fn(),
  }
})

function makeItem(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "item-1",
    topic: "t",
    category: "Presion arterial",
    format: "post",
    goal: "g",
    objective: "conversion",
    status: "draft",
    channels: ["instagram"],
    hook: "h",
    caption: "c",
    google_text: "g",
    hashtags: "#h",
    visual_headline: "vh",
    visual_subtitle: "vs",
    visual_style: "rose",
    source: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    approved_at: null,
    ...overrides,
  }
}

function makeTrack(overrides: Partial<AutoPublishTrackSettings>): AutoPublishTrackSettings {
  return {
    enabled: true,
    timezone: "America/Argentina/Buenos_Aires",
    schedule_slots: [{ day_of_week: 1, local_time: "19:00" }],
    items_per_run: 1,
    starts_at: null,
    last_published_at: null,
    last_run_at: null,
    last_run_result: null,
    ...overrides,
  }
}

function makeSettings(overrides: Partial<AutoPublishSettings> = {}): AutoPublishSettings {
  return {
    ...DEFAULT_AUTO_PUBLISH_SETTINGS,
    post: makeTrack({ enabled: false }),
    historia: makeTrack({ enabled: false }),
    carrusel: makeTrack({ enabled: false }),
    reel: makeTrack({ enabled: false }),
    ...overrides,
  }
}

describe("planAutoDrafts", () => {
  it("no propone nada para un formato desactivado", () => {
    const settings = makeSettings()
    expect(planAutoDrafts([], settings)).toEqual([])
  })

  it("propone reponer un formato activo sin nada esperando revision", () => {
    const settings = makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
    })
    const plan = planAutoDrafts([], settings)
    expect(plan).toEqual([{ format: "post", category: expect.any(String), objective: expect.any(String) }])
  })

  it("no propone nada si ya hay suficientes borradores/aprobados para la semana", () => {
    const settings = makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
    })
    const items = [makeItem({ id: "a", format: "post", status: "draft" })]
    expect(planAutoDrafts(items, settings)).toEqual([])
  })

  it("nunca incluye reel, aunque su track este activo y vacio", () => {
    const settings = makeSettings({
      reel: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 6, local_time: "19:00" }] }),
    })
    expect(planAutoDrafts([], settings)).toEqual([])
  })

  it("nunca repite la misma categoria dentro de la misma corrida", () => {
    const settings = makeSettings({
      historia: makeTrack({
        enabled: true,
        schedule_slots: [{ day_of_week: 1, local_time: "18:00" }, { day_of_week: 2, local_time: "18:00" }, { day_of_week: 4, local_time: "18:00" }],
        items_per_run: 1,
      }),
    })
    const plan = planAutoDrafts([], settings)
    const categories = plan.map(item => item.category)
    expect(categories.length).toBeGreaterThan(1)
    expect(new Set(categories).size).toBe(categories.length)
  })

  it("prefiere la categoria usada hace mas tiempo (o nunca usada)", () => {
    const settings = makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
    })
    const items = [
      makeItem({ id: "recent", category: "Presion arterial", status: "published", created_at: "2026-08-04T00:00:00.000Z" }),
      makeItem({ id: "old", category: "Colesterol", status: "published", created_at: "2026-01-01T00:00:00.000Z" }),
    ]
    const plan = planAutoDrafts(items, settings)
    expect(plan[0].category).not.toBe("Presion arterial")
  })

  it("respeta el tope por formato y por corrida", () => {
    const settings = makeSettings({
      historia: makeTrack({
        enabled: true,
        // 7 dias x 10 por corrida = deficit enorme, pero el tope por formato es 3
        schedule_slots: Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, local_time: "18:00" })),
        items_per_run: 10,
      }),
    })
    const plan = planAutoDrafts([], settings)
    expect(plan.length).toBe(3)
  })
})

describe("runAutoDraftGeneration", () => {
  const supabase = {} as SupabaseClient
  const now = new Date("2026-08-05T12:00:00Z")

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it("se salta sin error en modo manual (sin AI_MODE=gemini_api)", async () => {
    ;(getAiMode as jest.Mock).mockReturnValue("manual")
    const result = await runAutoDraftGeneration(supabase, now)
    expect(result).toEqual({ skipped: true, planned: 0, generated: 0 })
    expect(readContentItems).not.toHaveBeenCalled()
  })

  it("no genera nada si no hace falta reponer ningun formato", async () => {
    ;(getAiMode as jest.Mock).mockReturnValue("gemini_api")
    ;(readContentItems as jest.Mock).mockResolvedValue([])
    ;(readAutoPublishSettings as jest.Mock).mockResolvedValue(makeSettings())

    const result = await runAutoDraftGeneration(supabase, now)
    expect(result).toEqual({ skipped: false, planned: 0, generated: 0 })
    expect(generateContentPlan).not.toHaveBeenCalled()
    expect(writeContentItems).not.toHaveBeenCalled()
  })

  it("genera y guarda un borrador nuevo por cada pieza planeada", async () => {
    ;(getAiMode as jest.Mock).mockReturnValue("gemini_api")
    ;(readContentItems as jest.Mock).mockResolvedValue([])
    ;(readAutoPublishSettings as jest.Mock).mockResolvedValue(makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
    }))
    ;(generateContentPlan as jest.Mock).mockResolvedValue({
      hook: "h", caption: "c", google_text: "g", hashtags: "#a #b",
      visual_headline: "vh", visual_subtitle: "vs", visual_style: "rose",
      image_prompt: "ip", image_alt_text: "alt",
    })

    const result = await runAutoDraftGeneration(supabase, now)

    expect(result.skipped).toBe(false)
    expect(result.planned).toBe(1)
    expect(result.generated).toBe(1)
    expect(writeContentItems).toHaveBeenCalledTimes(1)
    const [, savedItems] = (writeContentItems as jest.Mock).mock.calls[0]
    expect(savedItems).toHaveLength(1)
    expect(savedItems[0]).toMatchObject({ status: "draft", format: "post", hook: "h" })
  })

  it("un fallo puntual no frena las piezas restantes, salvo que sea el limite diario", async () => {
    ;(getAiMode as jest.Mock).mockReturnValue("gemini_api")
    ;(readContentItems as jest.Mock).mockResolvedValue([])
    ;(readAutoPublishSettings as jest.Mock).mockResolvedValue(makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
      carrusel: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 0, local_time: "19:00" }], items_per_run: 1 }),
    }))
    ;(generateContentPlan as jest.Mock)
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce({
        hook: "h", caption: "c", google_text: "g", hashtags: "#a",
        visual_headline: "vh", visual_subtitle: "vs", visual_style: "rose",
      })

    const result = await runAutoDraftGeneration(supabase, now)

    expect(result.planned).toBe(2)
    expect(result.generated).toBe(1)
    expect(result.error).toBeDefined()
    expect(writeContentItems).toHaveBeenCalledTimes(1)
  })

  it("corta el resto de la corrida apenas se agota el limite diario de IA", async () => {
    ;(getAiMode as jest.Mock).mockReturnValue("gemini_api")
    ;(readContentItems as jest.Mock).mockResolvedValue([])
    ;(readAutoPublishSettings as jest.Mock).mockResolvedValue(makeSettings({
      post: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 4, local_time: "19:00" }], items_per_run: 1 }),
      carrusel: makeTrack({ enabled: true, schedule_slots: [{ day_of_week: 0, local_time: "19:00" }], items_per_run: 1 }),
    }))
    ;(generateContentPlan as jest.Mock).mockRejectedValue(new Error("DAILY_LIMIT_EXCEEDED:20"))

    const result = await runAutoDraftGeneration(supabase, now)

    expect(generateContentPlan).toHaveBeenCalledTimes(1)
    expect(result.generated).toBe(0)
    expect(result.error).toContain("límite diario")
  })
})
