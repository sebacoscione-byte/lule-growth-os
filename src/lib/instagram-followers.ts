import type { SupabaseClient } from "@supabase/supabase-js"
import { getValidToken, getFollowerCount } from "@/lib/instagram-business"

export interface InstagramFollowerSnapshotResult {
  skipped: boolean
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
    const followersCount = await getFollowerCount(token)
    const capturedOn = now.toISOString().slice(0, 10)
    const { error } = await supabase
      .from("instagram_follower_snapshots")
      .upsert({ captured_on: capturedOn, followers_count: followersCount }, { onConflict: "captured_on" })
    if (error) throw error
    return { skipped: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[instagram-followers] snapshot failed: ${message}`)
    return { skipped: false, error: message }
  }
}
