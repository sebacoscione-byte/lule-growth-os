import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateVideoDirection, getPublicAiError } from "@/lib/ai"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    const required = ["category", "topic", "visual_headline", "caption"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para proponer la dirección de video." }, { status: 400 })
    }

    const direction = await generateVideoDirection({
      category: (body.category as string).slice(0, 160),
      topic: (body.topic as string).slice(0, 200),
      visual_headline: (body.visual_headline as string).slice(0, 90),
      caption: (body.caption as string).slice(0, 3000),
      previous_video_prompt: typeof body.previous_video_prompt === "string" ? body.previous_video_prompt : undefined,
    })

    return NextResponse.json(direction)
  } catch (error) {
    console.error("[content/video-direction]", error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
