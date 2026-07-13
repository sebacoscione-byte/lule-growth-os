import { parseGooglePerformanceResponse } from "@/lib/google-performance"

describe("Google Business performance", () => {
  it("combina impresiones de desktop y mobile y conserva acciones", () => {
    const date = { year: 2026, month: 7, day: 12 }
    const response = {
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [
          { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", timeSeries: { datedValues: [{ date, value: "4" }] } },
          { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: [{ date, value: "9" }] } },
          { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [{ date, value: "7" }] } },
          { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ date, value: "3" }] } },
          { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date, value: "2" }] } },
          { dailyMetric: "BUSINESS_DIRECTION_REQUESTS", timeSeries: { datedValues: [{ date, value: "1" }] } },
        ],
      }],
    }

    expect(parseGooglePerformanceResponse(response)).toEqual([{
      captured_on: "2026-07-12",
      impressions_search: 13,
      impressions_maps: 7,
      website_clicks: 3,
      call_clicks: 2,
      direction_requests: 1,
    }])
  })

  it("ignora nodos incompletos sin inventar datos", () => {
    expect(parseGooglePerformanceResponse({ data: [{ dailyMetric: "WEBSITE_CLICKS" }] })).toEqual([])
  })
})
