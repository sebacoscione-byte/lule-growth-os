import {
  buildGrowthPeriodSummary,
  buildCampaignPerformance,
  combineChannelPerformance,
  normalizeDashboardChannel,
  parseDashboardPeriod,
  type GrowthTrendPoint,
} from "@/lib/dashboard-growth"

function point(values: Partial<GrowthTrendPoint>): GrowthTrendPoint {
  return {
    date: "2026-07-13", visits: 0, engagedVisits: 0, contactActions: 0,
    leads: 0, confirmed: 0, ...values,
  }
}

describe("dashboard growth", () => {
  it("acepta solo periodos soportados", () => {
    expect(parseDashboardPeriod("7")).toBe(7)
    expect(parseDashboardPeriod("365")).toBe(365)
    expect(parseDashboardPeriod("999")).toBe(30)
    expect(parseDashboardPeriod(undefined)).toBe(30)
  })

  it("compara el embudo actual con el periodo anterior", () => {
    const summary = buildGrowthPeriodSummary(
      [point({ visits: 100, engagedVisits: 30, contactActions: 42, leads: 10, confirmed: 4 })],
      [point({ visits: 80, engagedVisits: 20, contactActions: 25, leads: 8, confirmed: 2 })],
    )
    expect(summary.visits).toEqual({ current: 100, previous: 80 })
    expect(summary.visitToLeadRate).toEqual({ current: 10, previous: 10 })
    expect(summary.leadToConfirmedRate).toEqual({ current: 40, previous: 25 })
  })

  it("unifica aliases históricos de Instagram y recalcula las tasas", () => {
    expect(normalizeDashboardChannel("IG")).toBe("instagram")
    const channels = combineChannelPerformance([
      { channel: "instagram", visits: 20, previousVisits: 4, leads: 1, previousLeads: 0, confirmed: 0, previousConfirmed: 0 },
      { channel: "ig", visits: 19, previousVisits: 3, leads: 2, previousLeads: 1, confirmed: 1, previousConfirmed: 0 },
    ])
    expect(channels).toEqual([expect.objectContaining({
      channel: "instagram",
      visits: 39,
      previousVisits: 7,
      leads: 3,
      confirmed: 1,
      visitToLeadRate: 7.7,
      leadToConfirmedRate: 33.3,
    })])
  })

  it("calcula el embudo de una campaña UTM sin permitir conteos imposibles", () => {
    expect(buildCampaignPerformance({
      source: "instagram",
      medium: "paid_social",
      campaign: "presentacion_doctora_agosto_2026",
      content: "post_presentacion",
      visits: "100",
      engaged_visits: "120",
      leads: "8",
      confirmed: "12",
      first_seen: "2026-08-26",
      last_seen: "2026-09-01",
    })).toEqual({
      source: "instagram",
      medium: "paid_social",
      campaign: "presentacion_doctora_agosto_2026",
      content: "post_presentacion",
      visits: 100,
      engagedVisits: 100,
      leads: 8,
      confirmed: 8,
      visitToActionRate: 100,
      visitToLeadRate: 8,
      leadToConfirmedRate: 100,
      firstSeen: "2026-08-26",
      lastSeen: "2026-09-01",
    })
  })

  it("normaliza una campaña sin contenido y evita divisiones por cero", () => {
    expect(buildCampaignPerformance({
      source: null,
      medium: null,
      campaign: null,
      content: "sin_contenido",
      visits: 0,
      engaged_visits: 3,
      leads: 0,
      confirmed: 2,
    })).toEqual(expect.objectContaining({
      source: "direct",
      medium: "sin_medium",
      campaign: "sin_campana",
      content: null,
      engagedVisits: 0,
      confirmed: 0,
      visitToActionRate: 0,
      visitToLeadRate: 0,
      leadToConfirmedRate: 0,
    }))
  })
})
