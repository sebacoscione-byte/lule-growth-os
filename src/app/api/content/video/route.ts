import { NextResponse } from "next/server"
import { generateContentVideo, getPublicAiError } from "@/lib/ai"
import { burnVideoBrief } from "@/lib/video-caption"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const

// Veo es un proceso asincronico de varios minutos (ver generateContentVideo en ai.ts) -- muy por
// encima de cualquier otra ruta de este proyecto. 280s deja margen debajo del limite actual de
// funciones de Vercel (300s) para el pedido inicial + polling + descarga + upload a Storage + (si
// corresponde) componer el gancho/mensajes/CTA encima con ffmpeg, unos segundos mas.
export const maxDuration = 280

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    if (typeof body.video_prompt !== "string" || !body.video_prompt.trim()) {
      return NextResponse.json({ error: "Falta la dirección de video para generar el clip." }, { status: 400 })
    }
    const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : "sin-id"

    const video = await generateContentVideo({ video_prompt: (body.video_prompt as string).slice(0, 2400) })
    let buffer: Buffer = Buffer.from(video.video_data, "base64")

    // Si viene el brief (microinfografia: gancho/mensajes/CTA), se compone de una sobre el fondo que
    // acaba de generar Veo -- un solo click, un solo video final. Sin brief (uso del video_prompt
    // suelto, sin pasar por "Generar propuesta"), se sube el fondo tal cual generado.
    const hook = typeof body.hook === "string" ? body.hook.trim() : ""
    if (hook) {
      const messages = Array.isArray(body.messages)
        ? body.messages.filter((m): m is string => typeof m === "string").slice(0, 3)
        : []
      const cta = typeof body.cta === "string" ? body.cta.trim() : ""
      try {
        buffer = await burnVideoBrief({ videoBuffer: buffer, hook, messages, cta })
      } catch (error) {
        console.error("[content/video] no se pudo componer el brief sobre el video:",
          error instanceof Error ? error.message : String(error))
        // Seguimos con el fondo sin texto antes que perder la generación de Veo (tiene costo real) --
        // queda igual disponible el botón de "Agregar texto del guion al video" para reintentar.
      }
    }

    // Persistimos de una en Storage (service role, mismo patron que /api/content/visual): el video de
    // Google solo esta disponible 48hs en su propia URL, y nunca queremos que el navegador reciba el
    // archivo entero en la respuesta (podria pesar varios MB).
    const service = getServiceDb()
    const safeItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "sin-id"
    const path = `${safeItemId}-ai-${Date.now()}.mp4`
    const { error: uploadError } = await service.storage
      .from("content-media")
      .upload(path, buffer, { contentType: video.mime_type, upsert: true })
    if (uploadError) {
      console.error("No se pudo persistir el video generado en content-media:", uploadError.message)
      return NextResponse.json({ error: `El video se generó pero no se pudo guardar (${uploadError.message}).` }, { status: 500 })
    }
    const video_url = service.storage.from("content-media").getPublicUrl(path).data.publicUrl

    return NextResponse.json({ video_url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const normalized = message.toLowerCase()
    if (normalized.includes("quota") || normalized.includes("resource_exhausted") || normalized.includes("rate limit")) {
      return NextResponse.json({
        code: "VIDEO_QUOTA_UNAVAILABLE",
        error: "La clave de Gemini no tiene cuota disponible para generar video con Veo. Revisá el billing en Google AI Studio y volvé a intentar.",
        help_url: "https://ai.dev/rate-limit",
      }, { status: 429 })
    }
    console.error("[content/video]", message)
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
