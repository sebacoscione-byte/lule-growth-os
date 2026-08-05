import {
  buildContentPerformanceRows,
  buildContentStrategyRecommendations,
  getArgentinePublishSlot,
  metricsForLocation,
  type ContentAttributionAggregateRow,
} from "@/lib/content-performance"
import type { ContentItem, InstagramMediaInsightSnapshot } from "@/types"

function item(id: string, publishedAt: string, format: ContentItem["format"] = "carrusel"): ContentItem {
  return {
    id, status: "published", format, topic: id, category: "Educación", objective: "educacion",
    published_at: publishedAt, created_at: publishedAt, updated_at: publishedAt,
  } as ContentItem
}

function snapshot(id: string, reach: number, saved = 0, shares = 0): InstagramMediaInsightSnapshot {
  return {
    item_id: id, instagram_media_id: `media-${id}`, published_at: "2026-07-01T22:00:00Z",
    captured_at: "2026-07-08T22:00:00Z", capture_date: "2026-07-08", hours_since_publish: 168,
    reach, views: reach, likes: 0, comments: 0, saved, shares, follows: null, profile_visits: null,
    total_watch_time_ms: null, average_watch_time_ms: null, reels_skip_rate: null,
  }
}

describe("content performance", () => {
  it("usa el día argentino aunque UTC ya haya cruzado de fecha", () => {
    expect(getArgentinePublishSlot("2026-08-03T00:30:00Z")).toMatchObject({
      weekday: 0,
      hour: 21,
      label: "Dom 21–22",
    })
  })

  it("une por utm_content sin convertir un clic en conversación o lead", () => {
    const attribution: ContentAttributionAggregateRow[] = [{
      item_id: "piece-1", location_key: "cimel", visits: 4, clicks: 2, whatsapp_clicks: 1,
      conversations: 1, leads: 0, confirmed: 0,
    }]
    const rows = buildContentPerformanceRows(
      [item("piece-1", "2026-08-04T22:00:00Z")],
      { "piece-1": { "7d": snapshot("piece-1", 100) } },
      attribution,
    )
    expect(rows[0].attribution).toEqual({ visits: 4, clicks: 2, whatsappClicks: 1, conversations: 1, leads: 0, confirmed: 0 })
    expect(metricsForLocation(rows[0], "cimel")).toMatchObject({ visits: 4, clicks: 2, conversations: 1, leads: 0 })
  })

  it("no recomienda con menos de tres piezas por franja", () => {
    const items = [
      item("mon-1", "2026-07-06T22:00:00Z"), item("mon-2", "2026-07-13T22:00:00Z"),
      item("sun-1", "2026-07-05T22:00:00Z"), item("sun-2", "2026-07-12T22:00:00Z"),
    ]
    const windows = Object.fromEntries(items.map(value => [value.id, { "7d": snapshot(value.id, 100, 5, 2) }]))
    expect(buildContentStrategyRecommendations(buildContentPerformanceRows(items, windows, []))).toEqual([])
  })

  it("recomienda sólo dentro del mismo formato/objetivo cuando ambas franjas tienen muestra", () => {
    const items = [
      item("mon-1", "2026-07-06T22:00:00Z"), item("mon-2", "2026-07-13T22:00:00Z"), item("mon-3", "2026-07-20T22:00:00Z"),
      item("sun-1", "2026-07-05T22:00:00Z"), item("sun-2", "2026-07-12T22:00:00Z"), item("sun-3", "2026-07-19T22:00:00Z"),
    ]
    const windows = Object.fromEntries(items.map(value => [
      value.id,
      { "7d": snapshot(value.id, 100, value.id.startsWith("sun") ? 9 : 2, value.id.startsWith("sun") ? 3 : 1) },
    ]))
    const recommendations = buildContentStrategyRecommendations(buildContentPerformanceRows(items, windows, []))
    expect(recommendations).toHaveLength(1)
    expect(recommendations[0].summary).toContain("Hay 3 y 3 piezas comparables")
    expect(recommendations[0].evidence.betterSlot).toBe("Dom 19–20")
  })
})
