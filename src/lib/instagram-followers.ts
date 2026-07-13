import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getValidToken,
  getFollowerCount,
  getInstagramAccountInsights,
} from "@/lib/instagram-business"

export interface InstagramFollowerSnapshotResult {
  skipped: boolean
  insightsAvailable?: boolean
  error?: string
}

/**
 * Guarda un snapshot diario de seguidores de Instagram (upsert por captured_on, corre dentro del
 * cron de publish-content -- ver route.ts). "skipped" es el estado normal si Instagram todavía no
 * está conectado, no un error: no bloquea ni alerta el cron.
 */
export async function snapshotInstagramFollowers(
  supabase: SupabaseClient,
  now: Date
): Promise<InstagramFollowerSnapshotResult> {
  const token = await getValidToken(supabase)
  if (!token) return { skipped: true }

  try {
    const [followersCount, insights] = await Promise.all([
      getFollowerCount(token),
      getInstagramAccountInsights(token),
    ])
    const capturedOn = now.toISOString().slice(0, 10)
    const { error } = await supabase
      .from("instagram_follower_snapshots")
      .upsert({
        captured_on: capturedOn,
        followers_count: followersCount,
        reach: insights.reach,
        profile_views: insights.profileViews,
        link_taps: insights.linkTaps,
        total_interactions: insights.totalInteractions,
      }, { onConflict: "captured_on" })
    if (error) throw error
    return {
      skipped: false,
      insightsAvailable: Object.values(insights).some(value => value !== null),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[instagram-followers] snapshot failed: ${message}`)
    return { skipped: false, error: message }
  }
}
