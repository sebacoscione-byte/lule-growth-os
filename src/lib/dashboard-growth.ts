import type { SupabaseClient } from "@supabase/supabase-js"

export const DASHBOARD_PERIODS = [7, 30, 90, 365] as const
export type DashboardPeriod = typeof DASHBOARD_PERIODS[number]

export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  return DASHBOARD_PERIODS.includes(parsed as DashboardPeriod) ? parsed as DashboardPeriod : 30
}

export interface GrowthTrendPoint {
  date: string
  visits: number
  engagedVisits: number
  contactActions: number
  leads: number
  confirmed: number
}

export interface PeriodValue {
  current: number
  previous: number
}

export interface GrowthPeriodSummary {
  visits: PeriodValue
  engagedVisits: PeriodValue
  contactActions: PeriodValue
  leads: PeriodValue
  confirmed: PeriodValue
  visitToLeadRate: PeriodValue
  leadToConfirmedRate: PeriodValue
}

export interface ChannelPerformance {
  channel: string
  visits: number
  previousVisits: number
  leads: number
  previousLeads: number
  confirmed: number
  previousConfirmed: number
  visitToLeadRate: number
  leadToConfirmedRate: number
}

type ChannelCounts = Omit<ChannelPerformance, "visitToLeadRate" | "leadToConfirmedRate">

export interface ActionPerformance {
  eventType: string
  actions: number
  previousActions: number
  engagedVisits: number
}

export interface InstagramDashboardMetrics {
  available: boolean
  followers: number | null
  followersDelta: number | null
  reach: number | null
  profileViews: number | null
  linkTaps: number | null
  totalInteractions: number | null
  series: Array<{ date: string; followers: number }>
  firstSnapshotAt: string | null
}

export interface GoogleDashboardMetrics {
  available: boolean
  status: "available" | "quota_blocked" | "not_connected" | "pending" | "error" | null
  impressionsSearch: number | null
  impressionsMaps: number | null
  websiteClicks: number | null
  callClicks: number | null
  directionRequests: number | null
  rating: number | null
  reviewCount: number | null
  reviewDelta: number | null
  series: Array<{ date: string; reviews: number }>
}

export interface DashboardGrowthData {
  available: boolean
  trend: GrowthTrendPoint[]
  summary: GrowthPeriodSummary
  channels: ChannelPerformance[]
  actions: ActionPerformance[]
  instagram: InstagramDashboardMetrics
  google: GoogleDashboardMetrics
}

function sum(rows: GrowthTrendPoint[], field: keyof Omit<GrowthTrendPoint, "date">): number {
  return rows.reduce((total, row) => total + row[field], 0)
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0
}

export function normalizeDashboardChannel(channel: string): string {
  const normalized = channel.trim().toLowerCase()
  return normalized === "ig" || normalized === "insta" ? "instagram" : normalized
}

export function combineChannelPerformance(rows: ChannelCounts[]): ChannelPerformance[] {
  const grouped = new Map<string, ChannelCounts>()
  for (const row of rows) {
    const channel = normalizeDashboardChannel(row.channel)
    const current = grouped.get(channel) ?? {
      channel,
      visits: 0,
      previousVisits: 0,
      leads: 0,
      previousLeads: 0,
      confirmed: 0,
      previousConfirmed: 0,
    }
    current.visits += row.visits
    current.previousVisits += row.previousVisits
    current.leads += row.leads
    current.previousLeads += row.previousLeads
    current.confirmed += row.confirmed
    current.previousConfirmed += row.previousConfirmed
    grouped.set(channel, current)
  }

  return [...grouped.values()]
    .map(row => ({
      ...row,
      visitToLeadRate: rate(row.leads, row.visits),
      leadToConfirmedRate: rate(row.confirmed, row.leads),
    }))
    .sort((a, b) => b.confirmed - a.confirmed || b.leads - a.leads || b.visits - a.visits)
}

export function buildGrowthPeriodSummary(
  current: GrowthTrendPoint[],
  previous: GrowthTrendPoint[]
): GrowthPeriodSummary {
  const values = {
    visits: { current: sum(current, "visits"), previous: sum(previous, "visits") },
    engagedVisits: { current: sum(current, "engagedVisits"), previous: sum(previous, "engagedVisits") },
    contactActions: { current: sum(current, "contactActions"), previous: sum(previous, "contactActions") },
    leads: { current: sum(current, "leads"), previous: sum(previous, "leads") },
    confirmed: { current: sum(current, "confirmed"), previous: sum(previous, "confirmed") },
  }
  return {
    ...values,
    visitToLeadRate: {
      current: rate(values.leads.current, values.visits.current),
      previous: rate(values.leads.previous, values.visits.previous),
    },
    leadToConfirmedRate: {
      current: rate(values.confirmed.current, values.leads.current),
      previous: rate(values.confirmed.previous, values.leads.previous),
    },
  }
}

function emptySummary(): GrowthPeriodSummary {
  const zero = () => ({ current: 0, previous: 0 })
  return {
    visits: zero(), engagedVisits: zero(), contactActions: zero(), leads: zero(), confirmed: zero(),
    visitToLeadRate: zero(), leadToConfirmedRate: zero(),
  }
}

async function readTrend(supabase: SupabaseClient, period: DashboardPeriod) {
  const { data, error } = await supabase.rpc("dashboard_growth_timeseries", { p_days: period })
  if (error) throw error
  const rows = (data ?? []).map((row: Record<string, unknown>): GrowthTrendPoint => ({
    date: String(row.metric_date),
    visits: Number(row.visits),
    engagedVisits: Number(row.engaged_visits),
    contactActions: Number(row.contact_actions),
    leads: Number(row.leads),
    confirmed: Number(row.confirmed),
  }))
  return {
    current: rows.slice(-period),
    previous: rows.slice(-period * 2, -period),
  }
}

async function readChannels(supabase: SupabaseClient, period: DashboardPeriod): Promise<ChannelPerformance[]> {
  const { data, error } = await supabase.rpc("dashboard_channel_performance", { p_days: period })
  if (error) throw error
  return combineChannelPerformance((data ?? []).map((row: Record<string, unknown>) => ({
      channel: String(row.channel),
      visits: Number(row.visits),
      previousVisits: Number(row.previous_visits),
      leads: Number(row.leads),
      previousLeads: Number(row.previous_leads),
      confirmed: Number(row.confirmed),
      previousConfirmed: Number(row.previous_confirmed),
  })))
}

async function readActions(supabase: SupabaseClient, period: DashboardPeriod): Promise<ActionPerformance[]> {
  const { data, error } = await supabase.rpc("dashboard_action_totals", { p_days: period })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    eventType: String(row.event_type),
    actions: Number(row.actions),
    previousActions: Number(row.previous_actions),
    engagedVisits: Number(row.engaged_visits),
  }))
}

async function readInstagram(supabase: SupabaseClient, period: DashboardPeriod): Promise<InstagramDashboardMetrics> {
  try {
    const { data, error } = await supabase
      .from("instagram_follower_snapshots")
      .select("captured_on, followers_count, reach, profile_views, link_taps, total_interactions")
      .order("captured_on", { ascending: false })
      .limit(366)
    if (error) throw error
    const allRows = (data ?? []) as Array<{
      captured_on: string
      followers_count: number
      reach: number | null
      profile_views: number | null
      link_taps: number | null
      total_interactions: number | null
    }>
    if (allRows.length === 0) {
      return {
        available: true, followers: null, followersDelta: null, reach: null, profileViews: null,
        linkTaps: null, totalInteractions: null, series: [], firstSnapshotAt: null,
      }
    }
    const rows = allRows.slice(0, period).reverse()
    const latest = allRows[0]
    const first = rows[0]
    const nullableSum = (field: "reach" | "profile_views" | "link_taps" | "total_interactions") => {
      const values = rows.map(row => row[field]).filter((value): value is number => value !== null)
      return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
    }
    return {
      available: true,
      followers: latest.followers_count,
      followersDelta: rows.length > 1 ? latest.followers_count - first.followers_count : null,
      reach: nullableSum("reach"),
      profileViews: nullableSum("profile_views"),
      linkTaps: nullableSum("link_taps"),
      totalInteractions: nullableSum("total_interactions"),
      series: rows.map(row => ({ date: row.captured_on, followers: row.followers_count })),
      firstSnapshotAt: allRows.at(-1)?.captured_on ?? null,
    }
  } catch {
    return {
      available: false, followers: null, followersDelta: null, reach: null, profileViews: null,
      linkTaps: null, totalInteractions: null, series: [], firstSnapshotAt: null,
    }
  }
}

async function readGoogle(supabase: SupabaseClient, period: DashboardPeriod): Promise<GoogleDashboardMetrics> {
  try {
    const { data, error } = await supabase
      .from("google_business_snapshots")
      .select("captured_on, rating, review_count, impressions_search, impressions_maps, website_clicks, call_clicks, direction_requests, performance_status")
      .order("captured_on", { ascending: false })
      .limit(366)
    if (error) throw error
    const allRows = (data ?? []) as Array<{
      captured_on: string
      rating: number | string | null
      review_count: number | null
      impressions_search: number | null
      impressions_maps: number | null
      website_clicks: number | null
      call_clicks: number | null
      direction_requests: number | null
      performance_status: GoogleDashboardMetrics["status"]
    }>
    if (allRows.length === 0) {
      return {
        available: true, status: null, impressionsSearch: null, impressionsMaps: null,
        websiteClicks: null, callClicks: null, directionRequests: null, rating: null,
        reviewCount: null, reviewDelta: null, series: [],
      }
    }
    const rows = allRows.slice(0, period).reverse()
    const latest = allRows[0]
    const sumNullable = (field: "impressions_search" | "impressions_maps" | "website_clicks" | "call_clicks" | "direction_requests") => {
      const values = rows.map(row => row[field]).filter((value): value is number => value !== null)
      return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
    }
    const reviewRows = rows.filter(row => row.review_count !== null)
    return {
      available: true,
      status: latest.performance_status,
      impressionsSearch: sumNullable("impressions_search"),
      impressionsMaps: sumNullable("impressions_maps"),
      websiteClicks: sumNullable("website_clicks"),
      callClicks: sumNullable("call_clicks"),
      directionRequests: sumNullable("direction_requests"),
      rating: latest.rating === null ? null : Number(latest.rating),
      reviewCount: latest.review_count,
      reviewDelta: reviewRows.length > 1
        ? (reviewRows.at(-1)?.review_count ?? 0) - (reviewRows[0].review_count ?? 0)
        : null,
      series: reviewRows.map(row => ({ date: row.captured_on, reviews: row.review_count! })),
    }
  } catch {
    return {
      available: false, status: null, impressionsSearch: null, impressionsMaps: null,
      websiteClicks: null, callClicks: null, directionRequests: null, rating: null,
      reviewCount: null, reviewDelta: null, series: [],
    }
  }
}

export async function getDashboardGrowthData(
  supabase: SupabaseClient,
  period: DashboardPeriod
): Promise<DashboardGrowthData> {
  const [trendResult, channelsResult, actionsResult, instagram, google] = await Promise.all([
    readTrend(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readChannels(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readActions(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readInstagram(supabase, period),
    readGoogle(supabase, period),
  ])

  const trend = trendResult.ok ? trendResult.value.current : []
  return {
    available: trendResult.ok,
    trend,
    summary: trendResult.ok
      ? buildGrowthPeriodSummary(trendResult.value.current, trendResult.value.previous)
      : emptySummary(),
    channels: channelsResult.ok ? channelsResult.value : [],
    actions: actionsResult.ok ? actionsResult.value : [],
    instagram,
    google,
  }
}
