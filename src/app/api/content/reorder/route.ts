import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { readContentItems, writeContentItems, moveItemInQueue } from "@/lib/content-pipeline"
import { parseJsonBody } from "@/lib/api-validation"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { itemId, direction } = parsedBody.data as { itemId?: string; direction?: "up" | "down" }
  if (!itemId || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "itemId y direction (\"up\"/\"down\") son requeridos" }, { status: 400 })
  }

  const items = await readContentItems(supabase)
  const item = items.find(existing => existing.id === itemId)
  if (!item) return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 })
  if (item.status !== "approved") {
    return NextResponse.json({ error: "Solo se puede reordenar una pieza aprobada" }, { status: 400 })
  }

  // moveItemInQueue puede tocar el queue_rank de toda la cola de ese formato (normalizacion), asi que
  // se devuelve y guarda la lista completa en vez de un solo item.
  const reordered = moveItemInQueue(items, itemId, direction)
  await writeContentItems(supabase, reordered)

  return NextResponse.json({ items: reordered })
}
