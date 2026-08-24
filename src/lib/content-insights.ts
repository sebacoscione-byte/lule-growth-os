import type { SupabaseClient } from "@supabase/supabase-js"
import { mutateContentItems, readContentItems } from "@/lib/content-pipeline"
import { getValidToken, getInstagramMediaInsights } from "@/lib/instagram-business"
import type { InstagramMediaInsights } from "@/lib/instagram-business"
import type {
  ContentInstagramInsights,
  ContentItem,
  InstagramInsightWindow,
  InstagramMediaInsightSnapshot,
} from "@/types"

const SNAPSHOT_TABLE = "instagram_media_insight_snapshots"
const WINDOW_TARGETS: Record<InstagramInsightWindow, number> = { "24h": 24, "72h": 72, "7d": 168 }
export const INSIGHT_WINDOW_TOLERANCE_HOURS = 18

export interface ContentInsightsSnapshotResult {
  skipped: boolean
  refreshed: number
  error?: string
}

type SnapshotInsert = Omit<InstagramMediaInsightSnapshot, "id">

function argentinaDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function getContentPublishedAt(item: ContentItem): string | null {
  if (item.published_at) return item.published_at
  if (item.manual_publish_note?.marked_at) return item.manual_publish_note.marked_at
  return item.status === "published" ? item.updated_at : null
}

export function normalizeInstagramMediaInsights(
  insights: Partial<InstagramMediaInsights>,
  fetchedAt: string
): ContentInstagramInsights {
  return {
    reach: insights.reach ?? null,
    views: insights.views ?? null,
    likes: insights.likes ?? null,
    comments: insights.comments ?? null,
    saved: insights.saved ?? null,
    shares: insights.shares ?? null,
    follows: insights.follows ?? null,
    profile_visits: insights.profile_visits ?? null,
    total_watch_time_ms: insights.total_watch_time_ms ?? null,
    average_watch_time_ms: insights.average_watch_time_ms ?? null,
    reels_skip_rate: insights.reels_skip_rate ?? null,
    fetched_at: fetchedAt,
  }
}

export function buildInstagramInsightSnapshot(
  item: ContentItem,
  insights: Partial<InstagramMediaInsights>,
  capturedAt: Date
): SnapshotInsert | null {
  const publishedAt = getContentPublishedAt(item)
  if (!item.instagram_media_id || !publishedAt) return null
  const normalized = normalizeInstagramMediaInsights(insights, capturedAt.toISOString())
  const hoursSincePublish = Math.max(
    0,
    Math.round((capturedAt.getTime() - new Date(publishedAt).getTime()) / 3_600_000)
  )
  const { fetched_at: _fetchedAt, ...metrics } = normalized
  void _fetchedAt
  return {
    item_id: item.id,
    instagram_media_id: item.instagram_media_id,
    published_at: publishedAt,
    captured_at: capturedAt.toISOString(),
    capture_date: argentinaDateKey(capturedAt),
    hours_since_publish: hoursSincePublish,
    ...metrics,
  }
}

export async function persistInstagramInsightSnapshot(
  supabase: SupabaseClient,
  item: ContentItem,
  insights: Partial<InstagramMediaInsights>,
  capturedAt: Date
): Promise<boolean> {
  const snapshot = buildInstagramInsightSnapshot(item, insights, capturedAt)
  if (!snapshot) return false
  const { error } = await supabase.from(SNAPSHOT_TABLE).upsert({
    ...snapshot,
    raw_metrics_json: insights.rawMetrics ?? {},
    updated_at: capturedAt.toISOString(),
  }, { onConflict: "instagram_media_id,capture_date" })
  if (error) throw error
  return true
}

export function selectInstagramInsightWindows(
  snapshots: InstagramMediaInsightSnapshot[]
): Partial<Record<InstagramInsightWindow, InstagramMediaInsightSnapshot>> {
  const selected: Partial<Record<InstagramInsightWindow, InstagramMediaInsightSnapshot>> = {}
  for (const [window, target] of Object.entries(WINDOW_TARGETS) as Array<[InstagramInsightWindow, number]>) {
    const closest = snapshots
      .map(snapshot => ({ snapshot, distance: Math.abs(snapshot.hours_since_publish - target) }))
      .filter(candidate => candidate.distance <= INSIGHT_WINDOW_TOLERANCE_HOURS)
      .sort((a, b) => a.distance - b.distance ||
        new Date(b.snapshot.captured_at).getTime() - new Date(a.snapshot.captured_at).getTime())[0]
    if (closest) selected[window] = closest.snapshot
  }
  return selected
}

export async function readContentInsightWindows(
  supabase: SupabaseClient,
  items: ContentItem[]
): Promise<Record<string, Partial<Record<InstagramInsightWindow, InstagramMediaInsightSnapshot>>>> {
  const currentMediaByItem = new Map(
    items
      .filter(item => item.instagram_media_id)
      .map(item => [item.id, item.instagram_media_id as string])
  )
  if (currentMediaByItem.size === 0) return {}

  const { data, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select("id,item_id,instagram_media_id,published_at,captured_at,capture_date,hours_since_publish,reach,views,likes,comments,saved,shares,follows,profile_visits,total_watch_time_ms,average_watch_time_ms,reels_skip_rate")
    .in("item_id", [...currentMediaByItem.keys()])
    .order("captured_at", { ascending: true })
  if (error) {
    console.error(`[content-insights] history read failed: ${error.message}`)
    return {}
  }

  const grouped = new Map<string, InstagramMediaInsightSnapshot[]>()
  for (const row of (data ?? []) as InstagramMediaInsightSnapshot[]) {
    if (currentMediaByItem.get(row.item_id) !== row.instagram_media_id) continue
    grouped.set(row.item_id, [...(grouped.get(row.item_id) ?? []), row])
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([itemId, snapshots]) => [itemId, selectInstagramInsightWindows(snapshots)])
  )
}

/**
 * Refresca los insights de cada pieza publicada por API y conserva dos vistas: el último valor en
 * app_config para compatibilidad y un snapshot diario histórico. Un fallo puntual de Meta o de una
 * fila no frena las demás piezas. Las métricas ausentes quedan en null, nunca en cero inventado.
 */
export async function snapshotContentInsights(
  supabase: SupabaseClient,
  now: Date
): Promise<ContentInsightsSnapshotResult> {
  const token = await getValidToken(supabase)
  if (!token) return { skipped: true, refreshed: 0 }

  try {
    const items = await readContentItems(supabase)
    let refreshed = 0
    const errors: string[] = []
    const updated: ContentItem[] = []
    const insightUpdates = new Map<string, Pick<ContentItem, "published_at" | "instagram_insights">>()
    for (const item of items) {
      if (!item.instagram_media_id) {
        updated.push(item)
        continue
      }
      try {
        const insights = await getInstagramMediaInsights(token, item.instagram_media_id)
        const publishedAt = getContentPublishedAt(item)
        const itemWithPublishedAt = publishedAt && !item.published_at
          ? { ...item, published_at: publishedAt }
          : item
        await persistInstagramInsightSnapshot(supabase, itemWithPublishedAt, insights, now)
        refreshed++
        const refreshedItem = {
          ...itemWithPublishedAt,
          instagram_insights: normalizeInstagramMediaInsights(insights, now.toISOString()),
        }
        updated.push(refreshedItem)
        insightUpdates.set(item.id, {
          published_at: refreshedItem.published_at,
          instagram_insights: refreshedItem.instagram_insights,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`item=${item.id}: ${message}`)
        updated.push(item)
      }
    }
    if (refreshed > 0) {
      await mutateContentItems(supabase, latestItems => latestItems.map(item => {
        const patch = insightUpdates.get(item.id)
        return patch ? { ...item, ...patch } : item
      }))
    }
    return {
      skipped: false,
      refreshed,
      ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[content-insights] snapshot failed: ${message}`)
    return { skipped: false, refreshed: 0, error: message }
  }
}
