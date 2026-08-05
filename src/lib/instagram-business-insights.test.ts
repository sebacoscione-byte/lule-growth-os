import { getInstagramMediaInsights, parseInstagramInsightValue } from "@/lib/instagram-business"

describe("Instagram insights", () => {
  it("toma el valor diario mas reciente", () => {
    expect(parseInstagramInsightValue({
      data: [{ values: [{ value: 3 }, { value: 8 }] }],
    })).toBe(8)
  })

  it("acepta respuestas agregadas", () => {
    expect(parseInstagramInsightValue({
      data: [{ total_value: { value: 21 } }],
    })).toBe(21)
  })

  it("distingue una metrica sin datos de un cero real", () => {
    expect(parseInstagramInsightValue({ data: [] })).toBeNull()
    expect(parseInstagramInsightValue({ data: [{ values: [{ value: 0 }] }] })).toBe(0)
  })
})

describe("métricas por medio", () => {
  const originalFetch = global.fetch
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = originalFetch
    consoleError.mockRestore()
  })

  it("conserva las métricas disponibles aunque Meta rechace otra para ese formato", async () => {
    global.fetch = jest.fn(async input => {
      const metric = new URL(String(input)).searchParams.get("metric")
      if (metric === "ig_reels_video_view_total_time") {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "unsupported metric for media type" } }),
        } as Response
      }
      const value = metric === "reach" ? 120 : metric === "shares" ? 0 : undefined
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: value === undefined ? [] : [{ values: [{ value }] }] }),
      } as Response
    }) as typeof fetch

    const insights = await getInstagramMediaInsights("secret-not-logged", "media-1")

    expect(insights.reach).toBe(120)
    expect(insights.shares).toBe(0)
    expect(insights.total_watch_time_ms).toBeNull()
    expect(insights.views).toBeNull()
    expect(insights.rawMetrics.ig_reels_video_view_total_time).toBeNull()
  })
})
