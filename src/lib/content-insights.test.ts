import {
  buildInstagramInsightSnapshot,
  normalizeInstagramMediaInsights,
  selectInstagramInsightWindows,
  snapshotContentInsights,
} from "@/lib/content-insights"
import { mutateContentItems, readContentItems } from "@/lib/content-pipeline"
import { getValidToken, getInstagramMediaInsights } from "@/lib/instagram-business"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ContentItem } from "@/types"

jest.mock("@/lib/content-pipeline")
jest.mock("@/lib/instagram-business")

function makeItem(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "item-1",
    topic: "t",
    category: "c",
    format: "post",
    goal: "g",
    status: "published",
    channels: ["instagram"],
    hook: "h",
    caption: "c",
    google_text: "g",
    hashtags: "#h",
    visual_headline: "vh",
    visual_subtitle: "vs",
    visual_style: "rose",
    source: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    approved_at: null,
    ...overrides,
  }
}

const upsert = jest.fn()
const supabase = { from: jest.fn() } as unknown as SupabaseClient

const metaInsights = {
  reach: 100,
  views: 180,
  likes: 10,
  comments: 2,
  saved: 1,
  shares: 0,
  follows: null,
  profile_visits: 3,
  total_watch_time_ms: null,
  average_watch_time_ms: null,
  reels_skip_rate: null,
  rawMetrics: { reach: [{ name: "reach" }] },
}

describe("snapshotContentInsights", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    upsert.mockResolvedValue({ error: null })
    ;(supabase.from as jest.Mock).mockReturnValue({ upsert })
    ;(mutateContentItems as jest.Mock).mockImplementation(async (_db, mutation) =>
      mutation(await (readContentItems as jest.Mock)())
    )
  })

  it("no hace nada si Instagram no está conectado", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue(null)

    const result = await snapshotContentInsights(supabase, new Date("2026-07-29T12:00:00Z"))

    expect(result).toEqual({ skipped: true, refreshed: 0 })
    expect(mutateContentItems).not.toHaveBeenCalled()
  })

  it("guarda un snapshot por cada pieza con instagram_media_id y deja el resto intacto", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    const withMedia = makeItem({ id: "a", instagram_media_id: "media-a" })
    const withoutMedia = makeItem({ id: "b", instagram_media_id: null })
    ;(readContentItems as jest.Mock).mockResolvedValue([withMedia, withoutMedia])
    ;(getInstagramMediaInsights as jest.Mock).mockResolvedValue(metaInsights)

    const now = new Date("2026-07-29T12:00:00Z")
    const result = await snapshotContentInsights(supabase, now)

    expect(result).toEqual({ skipped: false, refreshed: 1 })
    expect(mutateContentItems).toHaveBeenCalledTimes(1)
    const [, mutation] = (mutateContentItems as jest.Mock).mock.calls[0]
    expect(mutation([withMedia, withoutMedia])).toEqual([
      {
        ...withMedia,
        published_at: withMedia.updated_at,
        instagram_insights: normalizeInstagramMediaInsights(metaInsights, now.toISOString()),
      },
      withoutMedia,
    ])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: "a",
        instagram_media_id: "media-a",
        capture_date: "2026-07-29",
        raw_metrics_json: metaInsights.rawMetrics,
      }),
      { onConflict: "instagram_media_id,capture_date" }
    )
  })

  it("un fallo puntual conserva el último snapshot bueno de esa pieza, sin frenar al resto", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    const previousSnapshot = normalizeInstagramMediaInsights({
      reach: 50, likes: 5, comments: 1, saved: 0, shares: 0,
    }, "2026-07-20T00:00:00.000Z")
    const broken = makeItem({ id: "broken", instagram_media_id: "media-broken", instagram_insights: previousSnapshot })
    const healthy = makeItem({ id: "healthy", instagram_media_id: "media-healthy" })
    ;(readContentItems as jest.Mock).mockResolvedValue([broken, healthy])
    ;(getInstagramMediaInsights as jest.Mock)
      .mockRejectedValueOnce(new Error("media too old"))
      .mockResolvedValueOnce({ ...metaInsights, reach: 200, likes: 20, comments: 4, saved: 2, shares: 1 })

    const now = new Date("2026-07-29T12:00:00Z")
    const result = await snapshotContentInsights(supabase, now)

    expect(result).toEqual({ skipped: false, refreshed: 1, error: "item=broken: media too old" })
    expect(mutateContentItems).toHaveBeenCalledTimes(1)
    const [, mutation] = (mutateContentItems as jest.Mock).mock.calls[0]
    expect(mutation([broken, healthy])).toEqual([
      broken,
      {
        ...healthy,
        published_at: healthy.updated_at,
        instagram_insights: normalizeInstagramMediaInsights({
          ...metaInsights, reach: 200, likes: 20, comments: 4, saved: 2, shares: 1,
        }, now.toISOString()),
      },
    ])
  })

  it("no escribe nada si ninguna pieza tiene instagram_media_id", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    ;(readContentItems as jest.Mock).mockResolvedValue([makeItem({ id: "a", instagram_media_id: null })])

    const result = await snapshotContentInsights(supabase, new Date("2026-07-29T12:00:00Z"))

    expect(result).toEqual({ skipped: false, refreshed: 0 })
    expect(mutateContentItems).not.toHaveBeenCalled()
  })

  it("un fallo al guardar una pieza no frena las siguientes", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    ;(readContentItems as jest.Mock).mockResolvedValue([
      makeItem({ id: "broken", instagram_media_id: "media-broken" }),
      makeItem({ id: "healthy", instagram_media_id: "media-healthy" }),
    ])
    ;(getInstagramMediaInsights as jest.Mock).mockResolvedValue(metaInsights)
    upsert.mockResolvedValueOnce({ error: new Error("db unavailable") }).mockResolvedValueOnce({ error: null })

    const result = await snapshotContentInsights(supabase, new Date("2026-07-29T12:00:00Z"))

    expect(result.refreshed).toBe(1)
    expect(result.error).toContain("item=broken")
    expect(upsert).toHaveBeenCalledTimes(2)
  })
})

describe("ventanas históricas", () => {
  const item = makeItem({
    id: "history",
    instagram_media_id: "media-history",
    published_at: "2026-07-01T22:00:00.000Z",
  })

  it("conserva null para métricas que Meta no expone", () => {
    const snapshot = buildInstagramInsightSnapshot(item, { reach: 20, views: undefined }, new Date("2026-07-02T22:00:00.000Z"))
    expect(snapshot).toEqual(expect.objectContaining({ reach: 20, views: null, follows: null }))
  })

  it("elige el snapshot más cercano a 24 h, 72 h y 7 días dentro de la tolerancia", () => {
    const snapshots = [20, 76, 170, 220].map((hours, index) => ({
      ...buildInstagramInsightSnapshot(item, { ...metaInsights, reach: index + 1 }, new Date(Date.parse(item.published_at as string) + hours * 3_600_000))!,
      hours_since_publish: hours,
    }))
    const selected = selectInstagramInsightWindows(snapshots)
    expect(selected["24h"]?.reach).toBe(1)
    expect(selected["72h"]?.reach).toBe(2)
    expect(selected["7d"]?.reach).toBe(3)
  })

  it("no reutiliza un snapshot lejano como si correspondiera a una ventana", () => {
    const snapshot = buildInstagramInsightSnapshot(item, metaInsights, new Date("2026-07-06T22:00:00.000Z"))!
    expect(selectInstagramInsightWindows([snapshot])).toEqual({})
  })
})
