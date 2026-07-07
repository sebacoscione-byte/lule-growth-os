import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { regenerateImageDirection, getPublicAiError } from "@/lib/ai"

const FORMATS = ["reel", "historia", "carrusel", "post"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const required = ["category", "topic", "visual_headline", "visual_subtitle", "caption"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para regenerar la dirección visual." }, { status: 400 })
    }
    if (!FORMATS.includes(body.format as typeof FORMATS[number])) {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400 })
    }

    const direction = await regenerateImageDirection({
      category: (body.category as string).slice(0, 160),
      topic: (body.topic as string).slice(0, 200),
      format: body.format as typeof FORMATS[number],
      visual_headline: (body.visual_headline as string).slice(0, 90),
      visual_subtitle: (body.visual_subtitle as string).slice(0, 90),
      caption: (body.caption as string).slice(0, 3000),
      previous_image_prompt: typeof body.previous_image_prompt === "string" ? body.previous_image_prompt : undefined,
    })

    return NextResponse.json(direction)
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
