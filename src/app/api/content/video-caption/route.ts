import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { burnCaptionsOntoVideo } from "@/lib/video-caption"
import { authorizeStaff } from "@/lib/staff-authz"
import type { ContentScene } from "@/types"

const CONTENT_ROLES = ["owner", "doctor"] as const

// ffmpeg corre local (no llama a ningún proveedor de IA) -- rápido para un clip de pocos segundos,
// pero se deja margen generoso por la descarga del video de entrada + la subida del resultado.
export const maxDuration = 90

function isValidScene(scene: unknown): scene is ContentScene {
  const s = scene as Partial<ContentScene>
  return typeof s?.onScreenText === "string" && typeof s?.from === "number" && typeof s?.to === "number"
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    const itemId = typeof body.itemId === "string" && body.itemId ? body.itemId : "sin-id"
    if (typeof body.videoUrl !== "string" || !body.videoUrl.trim()) {
      return NextResponse.json({ error: "Falta el video para agregarle el texto." }, { status: 400 })
    }
    if (!Array.isArray(body.scenes) || !body.scenes.every(isValidScene) || body.scenes.length === 0) {
      return NextResponse.json({ error: "No hay escenas con texto para quemar sobre el video." }, { status: 400 })
    }

    const videoRes = await fetch(body.videoUrl)
    if (!videoRes.ok) {
      return NextResponse.json({ error: `No se pudo descargar el video de origen (estado ${videoRes.status}).` }, { status: 500 })
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    const captioned = await burnCaptionsOntoVideo({ videoBuffer, scenes: body.scenes as ContentScene[] })

    const service = getServiceDb()
    const safeItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "sin-id"
    const path = `${safeItemId}-captioned-${Date.now()}.mp4`
    const { error: uploadError } = await service.storage
      .from("content-media")
      .upload(path, captioned, { contentType: "video/mp4", upsert: true })
    if (uploadError) {
      console.error("No se pudo persistir el video con texto en content-media:", uploadError.message)
      return NextResponse.json({ error: `El texto se quemó pero no se pudo guardar (${uploadError.message}).` }, { status: 500 })
    }
    const video_url = service.storage.from("content-media").getPublicUrl(path).data.publicUrl

    return NextResponse.json({ video_url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[content/video-caption]", message)
    return NextResponse.json({ error: `No se pudo agregar el texto al video: ${message}` }, { status: 500 })
  }
}
