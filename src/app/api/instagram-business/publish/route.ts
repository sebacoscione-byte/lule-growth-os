import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { publishImageToInstagram } from "@/lib/instagram-business"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as { itemId?: string; imageDataUrl?: string; imageUrl?: string; caption?: string; format?: string }
    if (!body.itemId || !(body.imageDataUrl || body.imageUrl) || !body.format) {
      return NextResponse.json({ error: "Falta la placa generada o el identificador del contenido." }, { status: 400 })
    }

    // getServiceDb() (service role puro), no createServiceClient(): ese cliente hidrata la sesion
    // del usuario desde las cookies y termina operando como el usuario logueado, no como service_role
    // real — rompe el upload a Storage, que solo permite escribir a service_role (ver content_media).
    const service = getServiceDb()
    const { mediaId } = await publishImageToInstagram(service, {
      itemId: body.itemId,
      imageDataUrl: body.imageDataUrl,
      imageUrl: body.imageUrl,
      caption: body.caption,
      format: body.format,
    })

    return NextResponse.json({ ok: true, mediaId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
