import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getLiveInstagramAccountMetrics,
  type LiveInstagramAccountMetrics,
} from "@/lib/instagram-followers"

export const DASHBOARD_PERIODS = [7, 30, 90, 365] as const
export type DashboardPeriod = typeof DASHBOARD_PERIODS[number]

export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  return DASHBOARD_PERIODS.includes(parsed as DashboardPeriod) ? parsed as DashboardPeriod : 7
}

export interface DashboardDateRange {
  currentStart: string
  currentEnd: string
  displayEnd: string
  previousStart: string
  previousEnd: string
  calendarWeek: boolean
}

const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires"

function argentinaDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARGENTINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const value = (type: "year" | "month" | "day") => Number(parts.find(part => part.type === type)?.value)
  return { year: value("year"), month: value("month"), day: value("day") }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * La vista de 7 días representa la semana calendario argentina en curso: lunes hasta hoy, con el
 * domingo como fin visible. Los demás períodos siguen siendo ventanas móviles inclusivas.
 */
export function getDashboardDateRange(period: DashboardPeriod, now = new Date()): DashboardDateRange {
  const parts = argentinaDateParts(now)
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  if (period === 7) {
    const daysSinceMonday = (today.getUTCDay() + 6) % 7
    const currentStart = addDays(today, -daysSinceMonday)
    const previousStart = addDays(currentStart, -7)
    return {
      currentStart: dateKey(currentStart),
      currentEnd: dateKey(today),
      displayEnd: dateKey(addDays(currentStart, 6)),
      previousStart: dateKey(previousStart),
      previousEnd: dateKey(addDays(previousStart, daysSinceMonday)),
      calendarWeek: true,
    }
  }

  const currentStart = addDays(today, -(period - 1))
  const previousEnd = addDays(currentStart, -1)
  return {
    currentStart: dateKey(currentStart),
    currentEnd: dateKey(today),
    displayEnd: dateKey(today),
    previousStart: dateKey(addDays(previousEnd, -(period - 1))),
    previousEnd: dateKey(previousEnd),
    calendarWeek: false,
  }
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

export interface CampaignPerformance {
  source: string
  medium: string
  campaign: string
  content: string | null
  visits: number
  engagedVisits: number
  leads: number
  confirmed: number
  visitToActionRate: number
  visitToLeadRate: number
  leadToConfirmedRate: number
  firstSeen: string | null
  lastSeen: string | null
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
  followersLive: boolean
  followersUpdatedAt: string | null
}

export interface InstagramFollowerSnapshotRow {
  captured_on: string
  followers_count: number
  reach: number | null
  profile_views: number | null
  link_taps: number | null
  total_interactions: number | null
  created_at: string | null
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
  campaigns: CampaignPerformance[]
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

function inDateRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

async function readTrend(supabase: SupabaseClient, period: DashboardPeriod, range: DashboardDateRange) {
  const { data, error } = await supabase.rpc("dashboard_growth_timeseries", { p_days: period })
  if (error) throw error
  const rows: GrowthTrendPoint[] = (data ?? []).map((row: Record<string, unknown>): GrowthTrendPoint => ({
    date: String(row.metric_date),
    visits: Number(row.visits),
    engagedVisits: Number(row.engaged_visits),
    contactActions: Number(row.contact_actions),
    leads: Number(row.leads),
    confirmed: Number(row.confirmed),
  }))
  return {
    current: rows.filter(row => inDateRange(row.date, range.currentStart, range.currentEnd)),
    previous: rows.filter(row => inDateRange(row.date, range.previousStart, range.previousEnd)),
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

export function buildCampaignPerformance(row: Record<string, unknown>): CampaignPerformance {
  const visits = Number(row.visits) || 0
  const engagedVisits = Math.min(visits, Number(row.engaged_visits) || 0)
  const leads = Number(row.leads) || 0
  const confirmed = Math.min(leads, Number(row.confirmed) || 0)
  const content = String(row.content ?? "").trim()

  return {
    source: String(row.source ?? "direct"),
    medium: String(row.medium ?? "sin_medium"),
    campaign: String(row.campaign ?? "sin_campana"),
    content: content && content !== "sin_contenido" ? content : null,
    visits,
    engagedVisits,
    leads,
    confirmed,
    visitToActionRate: rate(engagedVisits, visits),
    visitToLeadRate: rate(leads, visits),
    leadToConfirmedRate: rate(confirmed, leads),
    firstSeen: typeof row.first_seen === "string" ? row.first_seen : null,
    lastSeen: typeof row.last_seen === "string" ? row.last_seen : null,
  }
}

async function readCampaigns(supabase: SupabaseClient, period: DashboardPeriod): Promise<CampaignPerformance[]> {
  const { data, error } = await supabase.rpc("dashboard_campaign_performance", { p_days: period })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => buildCampaignPerformance(row))
}

export function buildInstagramDashboardMetrics(
  snapshotRows: InstagramFollowerSnapshotRow[],
  range: DashboardDateRange,
  live: LiveInstagramAccountMetrics | null,
): InstagramDashboardMetrics {
  const chronological = [...snapshotRows].sort((a, b) => a.captured_on.localeCompare(b.captured_on))

  if (live) {
    const todayIndex = chronological.findIndex(row => row.captured_on === range.currentEnd)
    const existing = todayIndex >= 0 ? chronological[todayIndex] : null
    const liveRow: InstagramFollowerSnapshotRow = {
      captured_on: range.currentEnd,
      followers_count: live.followersCount,
      reach: live.reach ?? existing?.reach ?? null,
      profile_views: live.profileViews ?? existing?.profile_views ?? null,
      link_taps: live.linkTaps ?? existing?.link_taps ?? null,
      total_interactions: live.totalInteractions ?? existing?.total_interactions ?? null,
      created_at: live.fetchedAt,
    }
    if (todayIndex >= 0) chronological[todayIndex] = liveRow
    else chronological.push(liveRow)
  }

  if (chronological.length === 0) {
    return {
      available: true, followers: null, followersDelta: null, reach: null, profileViews: null,
      linkTaps: null, totalInteractions: null, series: [], firstSnapshotAt: null,
      followersLive: false, followersUpdatedAt: null,
    }
  }

  const rows = chronological.filter(row => inDateRange(row.captured_on, range.currentStart, range.currentEnd))
  const latest = [...chronological].reverse().find(row => row.captured_on <= range.currentEnd) ?? chronological.at(-1)!
  const baseline = [...chronological].reverse().find(row => row.captured_on < range.currentStart) ?? rows[0]
  const nullableSum = (field: "reach" | "profile_views" | "link_taps" | "total_interactions") => {
    const values = rows.map(row => row[field]).filter((value): value is number => value !== null)
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
  }
  return {
    available: true,
    followers: latest.followers_count,
    followersDelta: baseline ? latest.followers_count - baseline.followers_count : null,
    reach: nullableSum("reach"),
    profileViews: nullableSum("profile_views"),
    linkTaps: nullableSum("link_taps"),
    totalInteractions: nullableSum("total_interactions"),
    series: rows.map(row => ({ date: row.captured_on, followers: row.followers_count })),
    firstSnapshotAt: chronological[0]?.captured_on ?? null,
    followersLive: Boolean(live),
    followersUpdatedAt: live?.fetchedAt ?? latest.created_at,
  }
}

async function readInstagram(supabase: SupabaseClient, range: DashboardDateRange): Promise<InstagramDashboardMetrics> {
  const [snapshotResult, live] = await Promise.all([
    supabase
      .from("instagram_follower_snapshots")
      .select("captured_on, followers_count, reach, profile_views, link_taps, total_interactions, created_at")
      .order("captured_on", { ascending: false })
      .limit(366),
    getLiveInstagramAccountMetrics(supabase).catch(() => null),
  ])

  if (snapshotResult.error && !live) {
    return {
      available: false, followers: null, followersDelta: null, reach: null, profileViews: null,
      linkTaps: null, totalInteractions: null, series: [], firstSnapshotAt: null,
      followersLive: false, followersUpdatedAt: null,
    }
  }
  return buildInstagramDashboardMetrics(
    (snapshotResult.data ?? []) as InstagramFollowerSnapshotRow[],
    range,
    live,
  )
}

async function readGoogle(supabase: SupabaseClient, range: DashboardDateRange): Promise<GoogleDashboardMetrics> {
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
    const chronological = [...allRows].reverse()
    const rows = chronological.filter(row => inDateRange(row.captured_on, range.currentStart, range.currentEnd))
    const latest = [...chronological].reverse().find(row => row.captured_on <= range.currentEnd) ?? allRows[0]
    const sumNullable = (field: "impressions_search" | "impressions_maps" | "website_clicks" | "call_clicks" | "direction_requests") => {
      const values = rows.map(row => row[field]).filter((value): value is number => value !== null)
      return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
    }
    const reviewRows = rows.filter(row => row.review_count !== null)
    const reviewBaseline = [...chronological].reverse().find(row => row.captured_on < range.currentStart && row.review_count !== null)
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
      reviewDelta: reviewBaseline && latest.review_count !== null
        ? latest.review_count - (reviewBaseline.review_count ?? 0)
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
  period: DashboardPeriod,
  now = new Date(),
): Promise<DashboardGrowthData> {
  const range = getDashboardDateRange(period, now)
  const [trendResult, channelsResult, actionsResult, campaignsResult, instagram, google] = await Promise.all([
    readTrend(supabase, period, range).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readChannels(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readActions(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readCampaigns(supabase, period).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    readInstagram(supabase, range),
    readGoogle(supabase, range),
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
    campaigns: campaignsResult.ok ? campaignsResult.value : [],
    instagram,
    google,
  }
}
