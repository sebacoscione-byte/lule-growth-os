import { NextResponse } from "next/server"
import { generateContentVisual, getPublicAiError, regenerateImageDirection } from "@/lib/ai"
import { truncateForImagePlate } from "@/lib/content-text"
import { getImagePromptQualityIssues, recentImagePrompts } from "@/lib/image-prompt-quality"
import { readContentItems } from "@/lib/content-pipeline"
import { convertImageToJpeg } from "@/lib/video-caption"
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
    if (body.version !== undefined && body.version !== "v1" && body.version !== "v2") {
      return NextResponse.json({ error: "Motor de generacion invalido." }, { status: 400 })
    }

    const version = body.version as "v1" | "v2" | undefined
    const resolvedVersion = version === "v2" ? "v2" : "v1"
    let imagePrompt = (body.image_prompt as string).slice(0, 2400)
    let imageDirectionRefreshed = false
    let imagePromptIssues: string[] = []

    // Evita el cliché recurrente "médica + escritorio + utilería clínica" y escenas demasiado
    // parecidas a piezas recientes -- aplica a V1 y V2 por igual (ambas comparten la misma
    // CREATIVE DIRECTION de escena, ver buildVisualPromptV1/V2 en ai.ts). Hasta el 2026-08-06 esto
    // se saltaba para V1 "para que siguiera siendo una comparación fiel con el motor histórico"
    // (V1 era la variante secundaria) -- ya no aplica: V1 es el motor default desde ese día.
    {
      const items = await readContentItems(supabase).catch(error => {
        console.error("No se pudieron leer prompts recientes para controlar diversidad:",
          error instanceof Error ? error.message : String(error))
        return []
      })
      const recentPrompts = recentImagePrompts(
        items,
        typeof body.sourceItemId === "string"
          ? body.sourceItemId
          : typeof body.itemId === "string" ? body.itemId : undefined
      )
      imagePromptIssues = getImagePromptQualityIssues(imagePrompt, recentPrompts)
      if (imagePromptIssues.length > 0) {
        let candidate = imagePrompt
        for (let attempt = 0; attempt < 2; attempt++) {
          const direction = await regenerateImageDirection({
            category: (body.category as string).slice(0, 160),
            topic: (body.topic as string).slice(0, 200),
            format: body.format as typeof FORMATS[number],
            visual_headline: (body.visual_headline as string).slice(0, 90),
            visual_subtitle: truncateForImagePlate(body.visual_subtitle as string, 120),
            caption: typeof body.caption === "string" && body.caption.trim()
              ? body.caption.slice(0, 3000)
              : `${body.topic}. ${body.visual_subtitle}`.slice(0, 3000),
            previous_image_prompt: candidate,
            recent_image_prompts: [imagePrompt, ...recentPrompts],
          })
          candidate = direction.image_prompt
          if (getImagePromptQualityIssues(candidate, [imagePrompt, ...recentPrompts]).length === 0) break
          if (attempt === 1) {
            throw new Error("La IA no logró proponer una escena suficientemente distinta. Volvé a intentar.")
          }
        }
        imagePrompt = candidate
        imageDirectionRefreshed = true
      }
    }

    const visual = await generateContentVisual({
      category: (body.category as string).slice(0, 160),
      topic: (body.topic as string).slice(0, 200),
      format: body.format as typeof FORMATS[number],
      visual_headline: (body.visual_headline as string).slice(0, 90),
      // V1: Gemini dibuja el texto -- pasarle el subtitulo COMPLETO (ya acotado a 90/300 caracteres
      // aguas arriba segun sea portada o slide de carrusel) y dejar que el prompt reforzado de
      // buildVisualPromptV1 lo ajuste con salto de linea/tamaño de fuente. Truncarlo aca a 120
      // caracteres (como necesita V2, ver composeContentPlate) cortaba una slide larga a mitad de
      // oracion -- ej. "...aumentando el" sin terminar la frase (bug real reportado 2026-08-06).
      // V2 sigue truncando: su layout compuesto por ffmpeg esta calibrado para un texto acotado.
      visual_subtitle: resolvedVersion === "v1"
        ? (body.visual_subtitle as string).slice(0, 300)
        : truncateForImagePlate(body.visual_subtitle as string, 120),
      image_prompt: imagePrompt,
      version,
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
      let mimeType = visual.mime_type
      let buffer: Buffer = Buffer.from(visual.image_data, "base64")
      // Portada de reel: Meta exige JPEG para cover_url (ver createVideoContainer) -- el resto de
      // los formatos no se usan como cover_url, así que se dejan tal cual genera Gemini.
      if (body.format === "reel" && mimeType !== "image/jpeg") {
        try {
          buffer = await convertImageToJpeg(buffer)
          mimeType = "image/jpeg"
        } catch (error) {
          console.error("No se pudo convertir la portada del reel a JPEG:",
            error instanceof Error ? error.message : String(error))
        }
      }
      const extension = mimeType === "image/png" ? "png" : "jpg"
      const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : "sin-id"
      const path = `${itemId}-${Date.now()}.${extension}`
      const { error: uploadError } = await service.storage
        .from("content-media")
        .upload(path, buffer, { contentType: mimeType, upsert: true })
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

    return NextResponse.json({
      ...visual,
      visual_url,
      visual_persist_error,
      image_prompt: imagePrompt,
      image_direction_refreshed: imageDirectionRefreshed,
      image_prompt_issues: imagePromptIssues,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Sin esto, un fallo de generateContentVisual (ej. composeContentPlate/ffmpeg) queda invisible:
    // no pasa por logRequest (eso solo cubre las llamadas a Gemini/OpenAI) y route.ts solo devolvia el
    // mensaje generico de getPublicAiError al cliente, sin dejar ningun rastro server-side de la causa
    // real (bug real 2026-08-03: la placa seguia fallando en produccion sin ninguna pista en los logs).
    console.error("No se pudo generar la placa visual:", message)
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
