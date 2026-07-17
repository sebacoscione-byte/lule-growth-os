import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems } from "@/lib/content-pipeline"
import { getValidToken, getInstagramMediaInsights } from "@/lib/instagram-business"

const CONTENT_ROLES = ["owner", "doctor"] as const

// Insights nativos (reach/likes/comments/guardados/compartidos) de una pieza ya publicada por API.
// Se piden en vivo a pedido (no se guarda un historial): media_id solo existe para piezas
// publicadas por este sistema desde que se agregó a content-publish.ts, así que piezas viejas no
// van a tener nada que consultar.
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
    return NextResponse.json({ insights })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[content/insights] item=${itemId} media=${item.instagram_media_id}: ${message}`)
    return NextResponse.json({ error: "No se pudieron obtener los insights de Instagram" }, { status: 502 })
  }
}
