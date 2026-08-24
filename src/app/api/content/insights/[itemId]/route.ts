import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { mutateContentItems, readContentItems } from "@/lib/content-pipeline"
import { getValidToken, getInstagramMediaInsights } from "@/lib/instagram-business"
import { normalizeInstagramMediaInsights, persistInstagramInsightSnapshot } from "@/lib/content-insights"
import { getServiceDb } from "@/lib/supabase/service"

const CONTENT_ROLES = ["owner", "doctor"] as const

// Insights nativos (reach/likes/comments/guardados/compartidos) de una pieza ya publicada por API.
// Se piden en vivo (media_id solo existe para piezas publicadas por este sistema desde que se
// agregó a content-publish.ts, así que piezas viejas no van a tener nada que consultar) y el
// resultado se guarda como instagram_insights en la pieza (ver types/index.ts) para no perderlo --
// el mismo snapshot también se refresca solo, todos los días, en el cron (ver
// src/lib/content-insights.ts), así que este endpoint no es la única forma de mantenerlo al día.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { itemId } = await params
  const items = await readContentItems(supabase)
  const item = items.find(existing => existing.id === itemId)
  if (!item) return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 })
  if (!item.instagram_media_id) {
    return NextResponse.json({ error: "Esta pieza no tiene un media_id de Instagram guardado (se publicó antes de que esto existiera, o no se publicó por API)" }, { status: 404 })
  }

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ error: "Instagram no está conectado" }, { status: 503 })

  try {
    const insights = await getInstagramMediaInsights(token, item.instagram_media_id)
    const capturedAt = new Date()
    const snapshot = normalizeInstagramMediaInsights(insights, capturedAt.toISOString())
    await mutateContentItems(supabase, latestItems =>
      latestItems.map(existing => existing.id === itemId ? {
        ...existing,
        published_at: existing.published_at ?? existing.manual_publish_note?.marked_at ?? existing.updated_at,
        instagram_insights: snapshot,
      } : existing)
    )
    try {
      await persistInstagramInsightSnapshot(getServiceDb(), item, insights, capturedAt)
    } catch (historyError) {
      console.error(`[content/insights] history item=${itemId}: ${historyError instanceof Error ? historyError.message : String(historyError)}`)
    }
    return NextResponse.json({ insights: snapshot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[content/insights] item=${itemId} media=${item.instagram_media_id}: ${message}`)
    return NextResponse.json({ error: "No se pudieron obtener los insights de Instagram" }, { status: 502 })
  }
}
