import { NextResponse } from "next/server"
import {
  generateContentPlan,
  buildContentPlanPrompt,
  generateInstagramContent,
  generateGooglePost,
  generateReviewReply,
  getPublicAiError,
  getAiMode,
} from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { type, category, content_type, cta, topic, source, appointment_link } = await request.json()
    const mode = getAiMode()

    // -------------------------------------------------------------------------
    // content_plan — supports both manual and gemini_api modes
    // -------------------------------------------------------------------------
    if (type === "content_plan") {
      if (!topic || !category || !content_type) {
        return NextResponse.json({ error: "topic, category and content_type required" }, { status: 400 })
      }

      const input = {
        topic,
        category,
        format: content_type as "reel" | "historia" | "carrusel" | "post",
        cta: cta ?? "",
        appointment_link: appointment_link ?? null,
        source: source ?? null,
      }

      if (mode === "manual") {
        const prompt = buildContentPlanPrompt(input)
        return NextResponse.json({ mode: "manual", prompt })
      }

      // gemini_api mode — try API, fall back to manual on rate limit
      try {
        const result = await generateContentPlan(input)
        return NextResponse.json({ mode: "api", ...result })
      } catch (e) {
        const publicError = getPublicAiError(e)
        const isRateLimit =
          publicError.startsWith("RATE_LIMIT:") ||
          publicError.includes("límite diario")
        if (isRateLimit) {
          const prompt = buildContentPlanPrompt(input)
          return NextResponse.json(
            { error: publicError.replace("RATE_LIMIT: ", ""), mode: "manual", prompt },
            { status: 429 }
          )
        }
        return NextResponse.json({ error: publicError }, { status: 500 })
      }
    }

    // -------------------------------------------------------------------------
    // instagram / google_post / review_reply — API mode only
    // -------------------------------------------------------------------------
    if (mode === "manual") {
      return NextResponse.json(
        { error: "Esta función requiere AI_MODE=gemini_api. Usá Generar propuesta completa para el modo manual." },
        { status: 400 }
      )
    }

    if (type === "instagram") {
      if (!category || !content_type) {
        return NextResponse.json({ error: "category and content_type required" }, { status: 400 })
      }
      const result = await generateInstagramContent(category, content_type, cta ?? "Escribí TURNO")
      return NextResponse.json(result)
    }

    if (type === "google_post") {
      if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 })
      const text = await generateGooglePost(topic)
      return NextResponse.json({ text })
    }

    if (type === "review_reply") {
      if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 })
      const [starLine, ...rest] = topic.split(". ")
      const starRating = starLine.replace(" stars", "").trim().toUpperCase()
      const comment = rest.join(". ")
      const text = await generateReviewReply(starRating, comment)
      return NextResponse.json({ text })
    }

    return NextResponse.json({ error: "invalid content type" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: getPublicAiError(e) }, { status: 500 })
  }
}
