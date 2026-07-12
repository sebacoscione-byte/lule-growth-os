import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

// Mismos canales que el check constraint de growth_experiments en la base (docs/schema.sql) — un
// valor fuera de esta lista rompería el insert igual, pero acá se rechaza con un mensaje claro.
// Además funciona como allowlist: antes este POST insertaba el body entero sin filtrar campos.
const createExperimentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  channel: z.enum(["google_maps", "seo", "instagram", "google_ads", "whatsapp", "referrals"]),
  hypothesis: z.string().trim().min(1).max(2000),
  content_or_action: z.string().trim().min(1).max(2000),
  start_date: z.string().trim().min(1).max(40),
  end_date: z.string().trim().max(40).optional().nullable(),
  metric_to_improve: z.string().trim().min(1).max(300),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("growth_experiments")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = createExperimentSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("growth_experiments")
    .insert([result.data])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
