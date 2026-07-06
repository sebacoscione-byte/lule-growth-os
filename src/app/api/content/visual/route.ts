import { NextResponse } from "next/server"
import { generateContentVisual, getPublicAiError } from "@/lib/ai"
import { createClient, createServiceClient } from "@/lib/supabase/server"

const FORMATS = ["reel", "historia", "carrusel", "post"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const required = ["category", "topic", "visual_headline", "visual_subtitle", "image_prompt"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para generar la placa visual." }, { status: 400 })
    }
    if (!FORMATS.includes(body.format as typeof FORMATS[number])) {
      return NextResponse.json({ error: "Formato visual invalido." }, { status: 400 })
    }

    const visual = await generateContentVisual({
      category: (body.category as string).slice(0, 160),
      topic: (body.topic as string).slice(0, 200),
      format: body.format as typeof FORMATS[number],
      visual_headline: (body.visual_headline as string).slice(0, 90),
      visual_subtitle: (body.visual_subtitle as string).slice(0, 90),
      image_prompt: (body.image_prompt as string).slice(0, 2400),
    })

    // Persistimos la placa en Storage de una: si no se guarda ahora, se pierde al navegar
    // (antes solo vivia en memoria del navegador hasta publicar).
    let visual_url: string | null = null
    try {
      const service = await createServiceClient()
      const extension = visual.mime_type === "image/png" ? "png" : "jpg"
      const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : "sin-id"
      const path = `${itemId}-${Date.now()}.${extension}`
      const buffer = Buffer.from(visual.image_data, "base64")
      const { error: uploadError } = await service.storage
        .from("content-media")
        .upload(path, buffer, { contentType: visual.mime_type, upsert: true })
      if (!uploadError) {
        visual_url = service.storage.from("content-media").getPublicUrl(path).data.publicUrl
      }
    } catch {
      // Si falla la persistencia, igual devolvemos la imagen para mostrarla/publicarla en el momento.
    }

    return NextResponse.json({ ...visual, visual_url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = message.toLowerCase()
    if (normalized.includes("quota") || normalized.includes("resource_exhausted") || normalized.includes("rate limit")) {
      return NextResponse.json({
        code: "IMAGE_QUOTA_UNAVAILABLE",
        error: "La clave de Gemini no tiene cuota disponible para generar imágenes. Activá billing o una cuota de imágenes en Google AI Studio y volvé a intentar.",
        help_url: "https://ai.dev/rate-limit",
      }, { status: 429 })
    }
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
