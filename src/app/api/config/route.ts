import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase.from("app_config").select("*")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const map: Record<string, unknown> = {}
  data?.forEach((row: { key: string; value: unknown }) => {
    map[row.key] = row.value
  })
  return NextResponse.json(map)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()
  const { key, value } = body as { key: string; value: unknown }

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key y value son requeridos" }, { status: 400 })
  }

  const { error } = await supabase
    .from("app_config")
    .upsert({ key, value }, { onConflict: "key" })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
