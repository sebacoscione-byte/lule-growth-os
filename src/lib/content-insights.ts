import type { SupabaseClient } from "@supabase/supabase-js"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
import { getValidToken, getInstagramMediaInsights } from "@/lib/instagram-business"

export interface ContentInsightsSnapshotResult {
  skipped: boolean
  refreshed: number
  error?: string
}

/**
 * Refresca el snapshot guardado de insights nativos (reach/likes/comments/guardados/compartidos)
 * de cada pieza publicada por API (instagram_media_id), corriendo dentro del mantenimiento diario.
 * Es el mismo dato que ya se guarda al pedirlo a
 * mano desde la UI (ver /api/content/insights/[itemId]), pero corriendo esto acá el dato se
 * mantiene al día aunque nadie vuelva a abrir la pieza.
 *
 * Un fallo puntual en una pieza (post muy viejo, métrica no habilitada para ese media) no debe
 * perder el último snapshot bueno que ya teníamos guardado -- esa pieza simplemente se deja tal
 * cual está en esta corrida.
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
    const updated: typeof items = []
    for (const item of items) {
      if (!item.instagram_media_id) {
        updated.push(item)
        continue
      }
      try {
        const insights = await getInstagramMediaInsights(token, item.instagram_media_id)
        refreshed++
        updated.push({ ...item, instagram_insights: { ...insights, fetched_at: now.toISOString() } })
      } catch {
        updated.push(item)
      }
    }
    if (refreshed > 0) await writeContentItems(supabase, updated)
    return { skipped: false, refreshed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[content-insights] snapshot failed: ${message}`)
    return { skipped: false, refreshed: 0, error: message }
  }
}
