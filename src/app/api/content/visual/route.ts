import { NextResponse } from "next/server"
import { generateContentVisual, getPublicAiError } from "@/lib/ai"
import { truncateForImagePlate } from "@/lib/content-text"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"

const FORMATS = ["reel", "historia", "carrusel", "post"] as const
const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

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
      visual_subtitle: truncateForImagePlate(body.visual_subtitle as string, 120),
      image_prompt: (body.image_prompt as string).slice(0, 2400),
    })

    // Persistimos la placa en Storage de una: si no se guarda ahora, se pierde al navegar
    // (antes solo vivia en memoria del navegador hasta publicar). Usa getServiceDb() (service role
    // puro, sin cookies) y no createServiceClient(): ese cliente hidrata la sesion del usuario desde
    // las cookies, y una vez que hay sesion el cliente de @supabase/ssr empieza a autenticar TODO
    // (incluido Storage) como ese usuario en vez de como service_role — y la policy de Storage de
    // content-media solo permite escribir a service_role real, asi que el upload fallaba en silencio.
    let visual_url: string | null = null
    let visual_persist_error: string | null = null
    try {
      const service = getServiceDb()
      const extension = visual.mime_type === "image/png" ? "png" : "jpg"
      const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : "sin-id"
      const path = `${itemId}-${Date.now()}.${extension}`
      const buffer = Buffer.from(visual.image_data, "base64")
      const { error: uploadError } = await service.storage
        .from("content-media")
        .upload(path, buffer, { contentType: visual.mime_type, upsert: true })
      if (uploadError) {
        console.error("No se pudo persistir la placa en content-media:", uploadError.message)
        visual_persist_error = uploadError.message
      } else {
        visual_url = service.storage.from("content-media").getPublicUrl(path).data.publicUrl
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("No se pudo persistir la placa en content-media:", message)
      visual_persist_error = message
    }

    return NextResponse.json({ ...visual, visual_url, visual_persist_error })
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
