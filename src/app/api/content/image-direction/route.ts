import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { regenerateImageDirection, getPublicAiError } from "@/lib/ai"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems } from "@/lib/content-pipeline"
import { getImagePromptQualityIssues, recentImagePrompts } from "@/lib/image-prompt-quality"

const FORMATS = ["reel", "historia", "carrusel", "post"] as const
const CONTENT_ROLES = ["owner", "doctor"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    const required = ["category", "topic", "visual_headline", "visual_subtitle", "caption"]
    if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) {
      return NextResponse.json({ error: "Faltan datos para regenerar la dirección visual." }, { status: 400 })
    }
    if (!FORMATS.includes(body.format as typeof FORMATS[number])) {
      return NextResponse.json({ error: "Formato inválido." }, { status: 400 })
    }

    const items = await readContentItems(supabase).catch(error => {
      console.error("[content/image-direction] no se pudieron leer prompts recientes:",
        error instanceof Error ? error.message : String(error))
      return []
    })
    const recentPrompts = recentImagePrompts(
      items,
      typeof body.itemId === "string" ? body.itemId : undefined
    )
    const originalPrompt = typeof body.previous_image_prompt === "string" ? body.previous_image_prompt : ""
    let previousPrompt = originalPrompt
    let direction: Awaited<ReturnType<typeof regenerateImageDirection>> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      direction = await regenerateImageDirection({
        category: (body.category as string).slice(0, 160),
        topic: (body.topic as string).slice(0, 200),
        format: body.format as typeof FORMATS[number],
        visual_headline: (body.visual_headline as string).slice(0, 90),
        visual_subtitle: (body.visual_subtitle as string).slice(0, 90),
        caption: (body.caption as string).slice(0, 3000),
        previous_image_prompt: previousPrompt || undefined,
        recent_image_prompts: [originalPrompt, ...recentPrompts].filter(Boolean),
      })
      if (getImagePromptQualityIssues(direction.image_prompt, [originalPrompt, ...recentPrompts]).length === 0) break
      previousPrompt = direction.image_prompt
      if (attempt === 1) {
        throw new Error("La IA no logró proponer una escena suficientemente distinta. Volvé a intentar.")
      }
    }

    return NextResponse.json(direction!)
  } catch (error) {
    console.error("[content/image-direction]", error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
