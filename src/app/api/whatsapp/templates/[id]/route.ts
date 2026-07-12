import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

// Mismo enum que el check constraint de templates en la base (docs/schema.sql) — un status fuera
// de esta lista rompería el update igual, pero acá se rechaza con un mensaje claro.
const templatePatchSchema = z.object({
  status: z.enum(["borrador", "pendiente_meta", "aprobado", "rechazado"]).optional(),
  body_text: z.string().trim().min(1).max(5000).optional(),
  variable_samples: z.array(z.string().max(200)).max(20).optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = templatePatchSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  if (Object.keys(result.data).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
  }

  const { data, error } = await supabase.from("templates").update(result.data).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
