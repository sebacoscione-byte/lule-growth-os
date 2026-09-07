import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import {
  mergeContentPublicationResult,
  mutateContentItems,
  readContentItems,
  resolveChannelsToPublish,
} from "@/lib/content-pipeline"
import { publishApprovedItem } from "@/lib/content-publish"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  try {
    const parsedBody = await parseJsonBody(request)
    if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

    const { itemId } = parsedBody.data as { itemId?: string }
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

    // Reintentar tras una publicacion parcial no debe volver a postear en el canal que ya salio bien.
    let channelsToPublish = resolveChannelsToPublish(item, item.channels)
    // Una pieza "aprobada" cuyo auto_publish_result marca como "published" a TODOS sus canales arrastra un
    // resultado viejo: si de verdad hubieran salido todos, estaria en "published", no en "approved" (ver
    // publishApprovedItem). Pasa cuando una pieza publicada se edita -> vuelve a borrador -> se reaprueba.
    // En ese caso el filtro deja la lista vacia y "Publicar ahora" no haria nada en silencio: republicar
    // en todos los canales asignados (publishApprovedItem pisa cada resultado con el intento fresco).
    if (channelsToPublish.length === 0) {
      channelsToPublish = [...item.channels]
    }

    // getServiceDb() (service role puro), no createServiceClient(): ver nota en instagram-business/publish.
    const service = getServiceDb()
    const { item: nextItem, allPublished } = await publishApprovedItem(service, item, channelsToPublish)
    await mutateContentItems(supabase, latestItems =>
      latestItems.map(existing => existing.id === item.id
        ? mergeContentPublicationResult(existing, item, nextItem)
        : existing)
    )

    return NextResponse.json({ item: nextItem, allPublished })
  } catch (error) {
    console.error(`[content/publish-now] ${error instanceof Error ? error.message : String(error)}`)
    return NextResponse.json({ error: "No se pudo completar la publicación" }, { status: 500 })
  }
}
