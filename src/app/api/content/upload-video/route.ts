import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const
const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}

/**
 * A diferencia de /api/content/upload-image (que recibe el archivo entero como data URL en el body),
 * un video puede pesar decenas de MB -- mandarlo como JSON por esta ruta arriesgaría el límite de
 * tamaño de body de las funciones serverless de Vercel. En cambio, esta ruta solo devuelve una URL de
 * subida firmada (createSignedUploadUrl, requiere service_role: la policy de Storage de content-media
 * solo permite insert a service_role) y el navegador sube el archivo directo a Supabase Storage con
 * esa URL/token -- los bytes nunca pasan por una función de este proyecto. Ver el uso en
 * contenido/instagram/page.tsx (handleVideoUpload) y la migración que fija file_size_limit del bucket.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const body = parsedBody.data as { itemId?: string; contentType?: string }
  const extension = body.contentType ? EXTENSION_BY_MIME[body.contentType] : undefined
  if (!body.itemId || !extension) {
    return NextResponse.json({ error: "Falta el video o el formato no está soportado. Usá MP4 o MOV." }, { status: 400 })
  }

  try {
    const service = getServiceDb()
    const safeItemId = body.itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "sin-id"
    const path = `${safeItemId}-${Date.now()}.${extension}`
    const { data, error } = await service.storage.from("content-media").createSignedUploadUrl(path)
    if (error || !data) throw error ?? new Error("No se pudo preparar la subida")
    const publicUrl = service.storage.from("content-media").getPublicUrl(path).data.publicUrl
    return NextResponse.json({ path: data.path, token: data.token, publicUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `No se pudo preparar la subida del video: ${message}` }, { status: 500 })
  }
}
