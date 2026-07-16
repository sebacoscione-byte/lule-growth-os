import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateImageAltText, getPublicAiError } from "@/lib/ai"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    const required = ["topic", "visual_headline", "visual_subtitle", "image_prompt"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para regenerar el texto alternativo." }, { status: 400 })
    }

    const image_alt_text = await generateImageAltText({
      topic: (body.topic as string).slice(0, 200),
      visual_headline: (body.visual_headline as string).slice(0, 90),
      visual_subtitle: (body.visual_subtitle as string).slice(0, 90),
      image_prompt: (body.image_prompt as string).slice(0, 2400),
    })

    return NextResponse.json({ image_alt_text: image_alt_text.trim().slice(0, 180) })
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
