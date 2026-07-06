import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
import { publishApprovedItem } from "@/lib/content-publish"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { itemId } = await request.json() as { itemId?: string }
  if (!itemId) return NextResponse.json({ error: "itemId requerido" }, { status: 400 })

  const items = await readContentItems(supabase)
  const item = items.find(existing => existing.id === itemId)
  if (!item) return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 })
  if (item.status !== "approved") {
    return NextResponse.json({ error: "Solo se puede publicar una pieza aprobada" }, { status: 400 })
  }
  if (!item.channels.length) {
    return NextResponse.json({ error: "La pieza no tiene ningun canal asignado (Instagram/Google)" }, { status: 400 })
  }

  const service = await createServiceClient()
  const { item: nextItem, allPublished } = await publishApprovedItem(service, item, item.channels)
  await writeContentItems(supabase, items.map(existing => existing.id === item.id ? nextItem : existing))

  return NextResponse.json({ item: nextItem, allPublished })
}
