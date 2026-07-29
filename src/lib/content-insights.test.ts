import { snapshotContentInsights } from "@/lib/content-insights"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
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

const supabase = {} as SupabaseClient

describe("snapshotContentInsights", () => {
  beforeEach(() => jest.resetAllMocks())

  it("no hace nada si Instagram no está conectado", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue(null)

    const result = await snapshotContentInsights(supabase, new Date("2026-07-29T12:00:00Z"))

    expect(result).toEqual({ skipped: true, refreshed: 0 })
    expect(writeContentItems).not.toHaveBeenCalled()
  })

  it("guarda un snapshot por cada pieza con instagram_media_id y deja el resto intacto", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    const withMedia = makeItem({ id: "a", instagram_media_id: "media-a" })
    const withoutMedia = makeItem({ id: "b", instagram_media_id: null })
    ;(readContentItems as jest.Mock).mockResolvedValue([withMedia, withoutMedia])
    ;(getInstagramMediaInsights as jest.Mock).mockResolvedValue({
      reach: 100, likes: 10, comments: 2, saved: 1, shares: 0,
    })

    const now = new Date("2026-07-29T12:00:00Z")
    const result = await snapshotContentInsights(supabase, now)

    expect(result).toEqual({ skipped: false, refreshed: 1 })
    expect(writeContentItems).toHaveBeenCalledWith(supabase, [
      { ...withMedia, instagram_insights: { reach: 100, likes: 10, comments: 2, saved: 1, shares: 0, fetched_at: now.toISOString() } },
      withoutMedia,
    ])
  })

  it("un fallo puntual conserva el último snapshot bueno de esa pieza, sin frenar al resto", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    const previousSnapshot = { reach: 50, likes: 5, comments: 1, saved: 0, shares: 0, fetched_at: "2026-07-20T00:00:00.000Z" }
    const broken = makeItem({ id: "broken", instagram_media_id: "media-broken", instagram_insights: previousSnapshot })
    const healthy = makeItem({ id: "healthy", instagram_media_id: "media-healthy" })
    ;(readContentItems as jest.Mock).mockResolvedValue([broken, healthy])
    ;(getInstagramMediaInsights as jest.Mock)
      .mockRejectedValueOnce(new Error("media too old"))
      .mockResolvedValueOnce({ reach: 200, likes: 20, comments: 4, saved: 2, shares: 1 })

    const now = new Date("2026-07-29T12:00:00Z")
    const result = await snapshotContentInsights(supabase, now)

    expect(result).toEqual({ skipped: false, refreshed: 1 })
    expect(writeContentItems).toHaveBeenCalledWith(supabase, [
      broken,
      { ...healthy, instagram_insights: { reach: 200, likes: 20, comments: 4, saved: 2, shares: 1, fetched_at: now.toISOString() } },
    ])
  })

  it("no escribe nada si ninguna pieza tiene instagram_media_id", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("token-123")
    ;(readContentItems as jest.Mock).mockResolvedValue([makeItem({ id: "a", instagram_media_id: null })])

    const result = await snapshotContentInsights(supabase, new Date("2026-07-29T12:00:00Z"))

    expect(result).toEqual({ skipped: false, refreshed: 0 })
    expect(writeContentItems).not.toHaveBeenCalled()
  })
})
