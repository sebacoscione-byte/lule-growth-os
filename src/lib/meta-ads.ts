import type { DashboardPeriod } from "@/lib/dashboard-growth"

const GRAPH_API_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/
const META_ADS_TIMEOUT_MS = 8_000
const MAX_INSIGHTS_PAGES = 10

export type MetaAdsStatus =
  | "available"
  | "not_configured"
  | "invalid_configuration"
  | "provider_rejected"
  | "provider_unavailable"
  | "invalid_provider_response"

export interface MetaAdsCampaignMetric {
  campaignId: string
  campaignName: string
  platform: string
  spend: number
  impressions: number
  reach: number
  linkClicks: number
  linkCtr: number
  costPerLinkClick: number | null
  dateStart: string
  dateStop: string
}

export interface MetaAdsDashboardMetrics {
  status: MetaAdsStatus
  missing: Array<"access_token" | "ad_account_id" | "graph_api_version">
  accountName: string | null
  currency: string | null
  campaigns: MetaAdsCampaignMetric[]
  totals: {
    spend: number
    impressions: number
    linkClicks: number
    linkCtr: number
    costPerLinkClick: number | null
  }
}

type MetaAdsEnvironment = {
  META_ADS_ACCESS_TOKEN?: string
  META_AD_ACCOUNT_ID?: string
  META_GRAPH_API_VERSION?: string
}

type FetchLike = typeof fetch

function emptyMetrics(
  status: MetaAdsStatus,
  missing: MetaAdsDashboardMetrics["missing"] = [],
): MetaAdsDashboardMetrics {
  return {
    status,
    missing,
    accountName: null,
    currency: null,
    campaigns: [],
    totals: { spend: 0, impressions: 0, linkClicks: 0, linkCtr: 0, costPerLinkClick: null },
  }
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function roundedRate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0
}

function roundedMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function argentinaDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value)
}

function classifyProviderFailure(status: number): MetaAdsStatus {
  return status >= 400 && status < 500 ? "provider_rejected" : "provider_unavailable"
}

function normalizeAdAccountId(value: string): string | null {
  const digits = value.trim().replace(/^act_/, "")
  return /^\d{5,30}$/.test(digits) ? `act_${digits}` : null
}

function normalizeEnvironment(env: MetaAdsEnvironment) {
  const token = env.META_ADS_ACCESS_TOKEN?.trim() ?? ""
  const rawAccountId = env.META_AD_ACCOUNT_ID?.trim() ?? ""
  const version = env.META_GRAPH_API_VERSION?.trim() ?? ""
  const missing: MetaAdsDashboardMetrics["missing"] = []
  if (!token) missing.push("access_token")
  if (!rawAccountId) missing.push("ad_account_id")
  if (!version) missing.push("graph_api_version")
  if (missing.length > 0) return { ok: false as const, status: "not_configured" as const, missing }

  const accountId = normalizeAdAccountId(rawAccountId)
  if (!accountId || !GRAPH_API_VERSION_PATTERN.test(version)) {
    return { ok: false as const, status: "invalid_configuration" as const, missing: [] }
  }
  return { ok: true as const, token, accountId, version }
}

function parseInsightRow(value: unknown): MetaAdsCampaignMetric | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (typeof row.campaign_id !== "string" || typeof row.campaign_name !== "string") return null
  if (typeof row.date_start !== "string" || typeof row.date_stop !== "string") return null

  const impressions = finiteNumber(row.impressions)
  const linkClicks = finiteNumber(row.inline_link_clicks)
  const spend = finiteNumber(row.spend)
  return {
    campaignId: row.campaign_id.slice(0, 100),
    campaignName: row.campaign_name.slice(0, 300),
    platform: typeof row.publisher_platform === "string"
      ? row.publisher_platform.slice(0, 40)
      : "sin_desglose",
    spend: roundedMoney(spend),
    impressions,
    reach: finiteNumber(row.reach),
    linkClicks,
    linkCtr: roundedRate(linkClicks, impressions),
    costPerLinkClick: linkClicks > 0 ? roundedMoney(spend / linkClicks) : null,
    dateStart: row.date_start,
    dateStop: row.date_stop,
  }
}

export async function getMetaAdsDashboardMetrics(
  period: DashboardPeriod,
  options: {
    env?: MetaAdsEnvironment
    fetcher?: FetchLike
    now?: Date
  } = {},
): Promise<MetaAdsDashboardMetrics> {
  const runtimeEnv: MetaAdsEnvironment = options.env ?? {
    META_ADS_ACCESS_TOKEN: process.env.META_ADS_ACCESS_TOKEN,
    META_AD_ACCOUNT_ID: process.env.META_AD_ACCOUNT_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  }
  const config = normalizeEnvironment(runtimeEnv)
  if (!config.ok) return emptyMetrics(config.status, config.missing)

  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? new Date()
  const since = argentinaDate(new Date(now.getTime() - (period - 1) * 24 * 60 * 60 * 1000))
  const until = argentinaDate(now)
  const base = `https://graph.facebook.com/${config.version}`
  const headers = { Authorization: `Bearer ${config.token}` }

  try {
    const accountUrl = new URL(`${base}/${config.accountId}`)
    accountUrl.searchParams.set("fields", "name,currency")
    const accountResponse = await fetcher(accountUrl, {
      headers,
      signal: AbortSignal.timeout(META_ADS_TIMEOUT_MS),
    })
    if (!accountResponse.ok) return emptyMetrics(classifyProviderFailure(accountResponse.status))

    const accountPayload = await accountResponse.json() as unknown
    if (!accountPayload || typeof accountPayload !== "object") {
      return emptyMetrics("invalid_provider_response")
    }
    const account = accountPayload as Record<string, unknown>
    if (typeof account.currency !== "string" || !/^[A-Za-z]{3}$/.test(account.currency)) {
      return emptyMetrics("invalid_provider_response")
    }

    const campaigns: MetaAdsCampaignMetric[] = []
    let after: string | null = null
    for (let page = 0; page < MAX_INSIGHTS_PAGES; page += 1) {
      const insightsUrl = new URL(`${base}/${config.accountId}/insights`)
      insightsUrl.searchParams.set(
        "fields",
        "campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,date_start,date_stop",
      )
      insightsUrl.searchParams.set("level", "campaign")
      insightsUrl.searchParams.set("breakdowns", "publisher_platform")
      insightsUrl.searchParams.set("time_range", JSON.stringify({ since, until }))
      insightsUrl.searchParams.set("limit", "100")
      if (after) insightsUrl.searchParams.set("after", after)

      const insightsResponse = await fetcher(insightsUrl, {
        headers,
        signal: AbortSignal.timeout(META_ADS_TIMEOUT_MS),
      })
      if (!insightsResponse.ok) return emptyMetrics(classifyProviderFailure(insightsResponse.status))

      const payload = await insightsResponse.json() as unknown
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
        return emptyMetrics("invalid_provider_response")
      }
      for (const row of (payload as { data: unknown[] }).data) {
        const parsed = parseInsightRow(row)
        if (parsed) campaigns.push(parsed)
      }

      const cursor = (payload as { paging?: { cursors?: { after?: unknown } } }).paging?.cursors?.after
      if (typeof cursor !== "string" || !cursor || cursor === after) break
      after = cursor
    }

    const spend = roundedMoney(campaigns.reduce((total, row) => total + row.spend, 0))
    const impressions = campaigns.reduce((total, row) => total + row.impressions, 0)
    const linkClicks = campaigns.reduce((total, row) => total + row.linkClicks, 0)
    return {
      status: "available",
      missing: [],
      accountName: typeof account.name === "string" ? account.name.slice(0, 200) : null,
      currency: account.currency.slice(0, 10).toUpperCase(),
      campaigns: campaigns.sort((a, b) => b.spend - a.spend || b.linkClicks - a.linkClicks),
      totals: {
        spend,
        impressions,
        linkClicks,
        linkCtr: roundedRate(linkClicks, impressions),
        costPerLinkClick: linkClicks > 0 ? roundedMoney(spend / linkClicks) : null,
      },
    }
  } catch {
    return emptyMetrics("provider_unavailable")
  }
}
