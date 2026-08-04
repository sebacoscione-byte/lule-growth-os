import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateVideoBrief, getPublicAiError } from "@/lib/ai"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems } from "@/lib/content-pipeline"
import type { ContentObjective, VideoGenerationVersion } from "@/types"

const CONTENT_ROLES = ["owner", "doctor"] as const
const OBJECTIVES = ["alcance", "educacion", "confianza", "conversion"] as const

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    if (typeof body.category !== "string" || !body.category.trim() || typeof body.topic !== "string" || !body.topic.trim()) {
      return NextResponse.json({ error: "Faltan datos para proponer el video." }, { status: 400 })
    }
    const objective = OBJECTIVES.includes(body.objective as ContentObjective) ? (body.objective as ContentObjective) : "conversion"
    const version: VideoGenerationVersion = body.version === "v1" ? "v1" : "v2"
    const itemId = typeof body.itemId === "string" ? body.itemId : ""
    const recentVisuals = version === "v2"
      ? (await readContentItems(supabase).catch(() => []))
        .filter(item => item.id !== itemId && item.format === "reel")
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 6)
        .map(item => [item.topic, item.video_brief?.visual_family, item.video_brief?.composition,
          item.video_brief?.reference_image_prompt].filter(Boolean).join(" — ").slice(0, 700))
      : []

    const result = await generateVideoBrief({
      category: body.category.slice(0, 160),
      topic: body.topic.slice(0, 200),
      objective,
      version,
      recent_visuals: recentVisuals,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("[content/video-brief]", error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
