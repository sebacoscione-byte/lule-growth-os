import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Únicas claves que este endpoint (usado por la pantalla de Configuración) puede leer/escribir.
// El resto de app_config (tokens de Google/Instagram, pipeline de contenido, etc.) se maneja
// por rutas dedicadas y nunca debe viajar al navegador de la doctora.
const CONFIG_KEYS = ["doctor", "locations"] as const

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

  const body = await req.json()
  const { key, value } = body as { key: string; value: unknown }

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
