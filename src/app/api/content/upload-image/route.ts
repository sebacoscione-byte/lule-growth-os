import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const MAX_BYTES = 8 * 1024 * 1024
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}
const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const body = parsedBody.data as { itemId?: string; imageDataUrl?: string }
  if (!body.itemId || typeof body.imageDataUrl !== "string") {
    return NextResponse.json({ error: "Falta la imagen o el id de la pieza." }, { status: 400 })
  }

  const match = body.imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) {
    return NextResponse.json({ error: "Formato de imagen no soportado. Usá PNG, JPG o WEBP." }, { status: 400 })
  }
  const mimeType = match[1]
  const buffer = Buffer.from(match[2], "base64")
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen no puede superar los 8 MB." }, { status: 400 })
  }

  try {
    // Mismo cliente que la placa generada con Gemini (getServiceDb(), service_role puro sin
    // cookies) — nunca @supabase/ssr con la service key, ver nota en src/app/api/content/visual/route.ts.
    const service = getServiceDb()
    const extension = EXTENSION_BY_MIME[mimeType]
    const safeItemId = body.itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "sin-id"
    const path = `${safeItemId}-${Date.now()}.${extension}`
    const { error: uploadError } = await service.storage
      .from("content-media")
      .upload(path, buffer, { contentType: mimeType, upsert: true })
    if (uploadError) throw uploadError
    const visual_url = service.storage.from("content-media").getPublicUrl(path).data.publicUrl
    return NextResponse.json({ visual_url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `No se pudo subir la imagen: ${message}` }, { status: 500 })
  }
}
