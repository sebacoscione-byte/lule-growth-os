import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { publishImageToInstagram, publishCarouselToInstagram } from "@/lib/instagram-business"

// Un carrusel espera hasta 10 contenedores de imagen (aunque en paralelo, ver publishCarouselToInstagram)
// mas el contenedor padre -- el default de la plataforma podria no alcanzar en un caso lento.
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as {
      itemId?: string; imageDataUrl?: string; imageUrl?: string; imageUrls?: string[]; caption?: string; format?: string
    }
    if (!body.itemId || !body.format) {
      return NextResponse.json({ error: "Falta el identificador del contenido o el formato." }, { status: 400 })
    }

    // getServiceDb() (service role puro), no createServiceClient(): ese cliente hidrata la sesion
    // del usuario desde las cookies y termina operando como el usuario logueado, no como service_role
    // real — rompe el upload a Storage, que solo permite escribir a service_role (ver content_media).
    const service = getServiceDb()

    if (body.format === "carrusel") {
      if (!Array.isArray(body.imageUrls) || body.imageUrls.length === 0) {
        return NextResponse.json({ error: "Faltan las placas generadas de cada slide del carrusel." }, { status: 400 })
      }
      const { mediaId } = await publishCarouselToInstagram(service, { imageUrls: body.imageUrls, caption: body.caption })
      return NextResponse.json({ ok: true, mediaId })
    }

    if (!body.imageDataUrl && !body.imageUrl) {
      return NextResponse.json({ error: "Falta la placa generada." }, { status: 400 })
    }
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
    console.error(`[instagram-business/publish] ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
