import { getMetaAdsDashboardMetrics } from "@/lib/meta-ads"

const ENV = {
  META_ADS_ACCESS_TOKEN: "test-token-never-log",
  META_AD_ACCOUNT_ID: "act_123456789",
  META_GRAPH_API_VERSION: "v25.0",
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("Meta Ads dashboard metrics", () => {
  it("falla en modo informativo sin intentar red cuando falta configuración", async () => {
    const fetcher = jest.fn()
    const result = await getMetaAdsDashboardMetrics(7, { env: {}, fetcher })

    expect(result.status).toBe("not_configured")
    expect(result.missing).toEqual(["access_token", "ad_account_id", "graph_api_version"])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("consulta por Bearer, pagina con cursor y calcula métricas de links", async () => {
    const fetcher = jest.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.toString()).not.toContain(ENV.META_ADS_ACCESS_TOKEN)
      expect(init?.headers).toEqual({ Authorization: `Bearer ${ENV.META_ADS_ACCESS_TOKEN}` })

      if (!url.pathname.endsWith("/insights")) {
        return response({ id: "act_123456789", name: "Dra. Lucía Chahin", currency: "USD" })
      }
      if (!url.searchParams.has("after")) {
        expect(JSON.parse(url.searchParams.get("time_range") ?? "{}")).toEqual({
          since: "2026-08-24",
          until: "2026-08-26",
        })
        return response({
          data: [{
            campaign_id: "1",
            campaign_name: "Presentación doctora",
            publisher_platform: "instagram",
            spend: "12.50",
            impressions: "1000",
            reach: "800",
            inline_link_clicks: "25",
            date_start: "2026-08-20",
            date_stop: "2026-08-26",
          }],
          paging: { cursors: { after: "cursor-2" } },
        })
      }
      expect(url.searchParams.get("after")).toBe("cursor-2")
      return response({
        data: [{
          campaign_id: "1",
          campaign_name: "Presentación doctora",
          publisher_platform: "facebook",
          spend: "7.50",
          impressions: "500",
          reach: "420",
          inline_link_clicks: "5",
          date_start: "2026-08-20",
          date_stop: "2026-08-26",
        }],
      })
    }) as typeof fetch

    const result = await getMetaAdsDashboardMetrics(7, {
      env: ENV,
      fetcher,
      now: new Date("2026-08-26T15:00:00.000Z"),
    })

    expect(result).toEqual(expect.objectContaining({
      status: "available",
      accountName: "Dra. Lucía Chahin",
      currency: "USD",
      totals: {
        spend: 20,
        impressions: 1500,
        linkClicks: 30,
        linkCtr: 2,
        costPerLinkClick: 0.67,
      },
    }))
    expect(result.campaigns).toEqual([
      expect.objectContaining({ platform: "instagram", linkCtr: 2.5, costPerLinkClick: 0.5 }),
      expect.objectContaining({ platform: "facebook", linkCtr: 1, costPerLinkClick: 1.5 }),
    ])
  })

  it("no propaga el cuerpo ni los secretos cuando Meta rechaza la credencial", async () => {
    const fetcher = jest.fn(async () => response({ error: { message: "secret provider detail" } }, 401)) as typeof fetch
    const result = await getMetaAdsDashboardMetrics(30, { env: ENV, fetcher })

    expect(result.status).toBe("provider_rejected")
    expect(JSON.stringify(result)).not.toContain("secret provider detail")
    expect(JSON.stringify(result)).not.toContain(ENV.META_ADS_ACCESS_TOKEN)
  })
})
