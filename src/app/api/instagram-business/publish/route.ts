import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import {
  createImageContainer,
  getValidToken,
  publishContainer,
  waitForContainerReady,
} from "@/lib/instagram-business"

const PUBLISHABLE_FORMATS = ["post", "historia"] as const

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } {
  const match = /^data:(image\/(png|jpe?g));base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error("La placa generada no tiene un formato de imagen valido (PNG o JPEG).")
  const [, contentType, subtype, base64] = match
  return { buffer: Buffer.from(base64, "base64"), contentType, extension: subtype === "jpeg" ? "jpg" : subtype }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as { itemId?: string; imageDataUrl?: string; caption?: string; format?: string }
    if (!body.itemId || !body.imageDataUrl) {
      return NextResponse.json({ error: "Falta la placa generada o el identificador del contenido." }, { status: 400 })
    }
    if (!PUBLISHABLE_FORMATS.includes(body.format as typeof PUBLISHABLE_FORMATS[number])) {
      return NextResponse.json({ error: "Instagram solo permite publicar posts o historias por API. Reels y carruseles requieren video o multiples imagenes; usa Copiar Instagram." }, { status: 400 })
    }

    const service = await createServiceClient()
    const token = await getValidToken(service)
    if (!token) return NextResponse.json({ error: "Instagram no esta conectado. Conectá la cuenta primero." }, { status: 400 })

    const { buffer, contentType, extension } = parseDataUrl(body.imageDataUrl)
    const path = `${body.itemId}-${Date.now()}.${extension}`
    const { error: uploadError } = await service.storage
      .from("content-media")
      .upload(path, buffer, { contentType, upsert: true })
    if (uploadError) throw new Error(`No se pudo subir la imagen: ${uploadError.message}`)

    const { data: publicUrlData } = service.storage.from("content-media").getPublicUrl(path)
    const imageUrl = publicUrlData.publicUrl

    const asStory = body.format === "historia"
    const containerId = await createImageContainer(token, imageUrl, {
      asStory,
      caption: asStory ? undefined : (body.caption ?? "").slice(0, 2200),
    })
    await waitForContainerReady(token, containerId)
    const mediaId = await publishContainer(token, containerId)

    return NextResponse.json({ ok: true, mediaId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
