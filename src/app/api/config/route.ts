import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseJsonBody } from "@/lib/api-validation"

// Únicas claves que este endpoint (usado por la pantalla de Configuración y por el panel de
// auto-publicación del Estudio de contenido) puede leer/escribir. El resto de app_config (tokens
// de Google/Instagram, el array completo de content_pipeline, etc.) se maneja por rutas dedicadas
// y nunca debe viajar al navegador de la doctora.
const CONFIG_KEYS = ["doctor", "locations", "whatsapp_settings", "auto_publish_settings"] as const

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", CONFIG_KEYS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const map: Record<string, unknown> = {}
  data?.forEach((row: { key: string; value: unknown }) => {
    map[row.key] = row.value
  })
  return NextResponse.json(map)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { key, value } = parsedBody.data as { key?: string; value: unknown }

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key y value son requeridos" }, { status: 400 })
  }
  if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
    return NextResponse.json({ error: "key no permitida" }, { status: 400 })
  }

  const { error } = await supabase
    .from("app_config")
    .upsert({ key, value }, { onConflict: "key" })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
