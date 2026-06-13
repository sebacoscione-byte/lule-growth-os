import { NextResponse } from "next/server"
import { generateContentVisual, getPublicAiError } from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"

const FORMATS = ["reel", "historia", "carrusel", "post"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json() as Record<string, unknown>
    const required = ["category", "topic", "visual_headline", "visual_subtitle", "image_prompt"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para generar la placa visual." }, { status: 400 })
    }
    if (!FORMATS.includes(body.format as typeof FORMATS[number])) {
      return NextResponse.json({ error: "Formato visual invalido." }, { status: 400 })
    }

    const visual = await generateContentVisual({
      category: (body.category as string).slice(0, 160),
      topic: (body.topic as string).slice(0, 200),
      format: body.format as typeof FORMATS[number],
      visual_headline: (body.visual_headline as string).slice(0, 90),
      visual_subtitle: (body.visual_subtitle as string).slice(0, 90),
      image_prompt: (body.image_prompt as string).slice(0, 2400),
    })
    return NextResponse.json(visual)
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
