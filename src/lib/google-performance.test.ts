import { parseGooglePerformanceResponse, snapshotGoogleBusinessMetrics } from "@/lib/google-performance"
import { getConnectionInfo, getValidToken } from "@/lib/google-business"
import { getGooglePlaceReviews } from "@/lib/google-places"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/google-business")
jest.mock("@/lib/google-places")

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

  it("trata un refresh token vencido (modo Prueba de Google) como not_connected, sin alertar por error", async () => {
    // Mismo caso que ya maneja /api/google-business/status: en modo Prueba el refresh token de
    // Google vence cada ~7 días y getValidToken() rechaza en vez de devolver null. Antes de este
    // fix, eso se colaba como status="error" y disparaba una alerta de cron por email todos los
    // días hasta reconectar manualmente -- ver snapshotGoogleBusinessMetrics.
    ;(getConnectionInfo as jest.Mock).mockResolvedValue({ google_location_id: "loc123" })
    ;(getValidToken as jest.Mock).mockRejectedValue(new Error("Token refresh failed: invalid_grant"))
    ;(getGooglePlaceReviews as jest.Mock).mockResolvedValue(null)

    const upsert = jest.fn().mockResolvedValue({ error: null })
    const supabase = { from: jest.fn().mockReturnValue({ upsert }) } as unknown as SupabaseClient

    const result = await snapshotGoogleBusinessMetrics(supabase, new Date("2026-07-13T11:00:00Z"))

    expect(result.status).toBe("not_connected")
    expect(result.error).toBeUndefined()
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ performance_status: "not_connected" })],
      { onConflict: "captured_on" }
    )
  })
})
