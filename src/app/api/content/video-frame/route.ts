import { NextResponse } from "next/server"
import { generateVideoReferenceFrame, getPublicAiError, reviewVideoReferenceFrame } from "@/lib/ai"
import { readContentItems } from "@/lib/content-pipeline"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"

const CONTENT_ROLES = ["owner", "doctor"] as const
const MAX_FRAME_ATTEMPTS = 3
export const maxDuration = 180

function recentVisualDescriptions(items: Awaited<ReturnType<typeof readContentItems>>, currentId: string): string[] {
  return items
    .filter(item => item.id !== currentId && item.format === "reel")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)
    .map(item => [
      item.topic,
      item.video_brief?.visual_family,
      item.video_brief?.composition,
      item.video_brief?.reference_image_prompt,
    ].filter(Boolean).join(" — ").slice(0, 700))
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await authorizeStaff(supabase, { allowedRoles: CONTENT_ROLES, sensitive: true })
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

    const body = await request.json() as Record<string, unknown>
    if (typeof body.itemId !== "string" || !body.itemId || typeof body.topic !== "string" || !body.topic.trim() ||
      typeof body.reference_image_prompt !== "string" || !body.reference_image_prompt.trim()) {
      return NextResponse.json({ error: "Falta la propuesta visual V2 para generar el fotograma." }, { status: 400 })
    }
    const itemId = body.itemId
    const items = await readContentItems(supabase).catch(() => [])
    const recentVisuals = recentVisualDescriptions(items, itemId)
    let direction = body.reference_image_prompt.slice(0, 2400)
    let lastReview = null

    for (let attempt = 1; attempt <= MAX_FRAME_ATTEMPTS; attempt++) {
      const frame = await generateVideoReferenceFrame({ topic: body.topic.slice(0, 200), reference_image_prompt: direction })
      const review = await reviewVideoReferenceFrame({
        topic: body.topic.slice(0, 200),
        mime_type: frame.mime_type,
        image_data: frame.image_data,
        recent_visuals: recentVisuals,
      })
      lastReview = review
      if (!review.approved) {
        direction = `${body.reference_image_prompt.slice(0, 1700)}\n\nCORRECTION AFTER REJECTED FRAME: ${review.notes}. Critical failures: ${review.critical_failures.join(", ") || "none"}. Produce a substantially different, medically credible composition. If a stethoscope is visible, place its chestpiece on the chest/thorax only, never abdomen, belly or stomach.`
        continue
      }

      const service = getServiceDb()
      const safeItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "sin-id"
      const extension = frame.mime_type === "image/png" ? "png" : "jpg"
      const path = `${safeItemId}-video-frame-${Date.now()}.${extension}`
      const { error: uploadError } = await service.storage.from("content-media").upload(
        path,
        Buffer.from(frame.image_data, "base64"),
        { contentType: frame.mime_type, upsert: true },
      )
      if (uploadError) throw new Error(`El fotograma se genero pero no se pudo guardar (${uploadError.message}).`)
      const frameUrl = service.storage.from("content-media").getPublicUrl(path).data.publicUrl
      return NextResponse.json({
        video_reference_frame_url: frameUrl,
        video_reference_frame_path: path,
        video_reference_frame_review: review,
        attempts: attempt,
      })
    }

    console.warn("[content/video-frame] fotogramas rechazados", {
      attempts: MAX_FRAME_ATTEMPTS,
      critical_failures: lastReview?.critical_failures ?? [],
      scores: lastReview?.scores ?? null,
    })
    return NextResponse.json({
      code: "VIDEO_FRAME_REJECTED",
      error: "Los fotogramas no superaron la revision de autenticidad y credibilidad medica. No se habilito la generacion del video.",
      review: lastReview,
    }, { status: 422 })
  } catch (error) {
    console.error("[content/video-frame]", error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
