import { NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
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

    const service = await createServiceClient()
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
