import { NextResponse } from "next/server"
import { generateContentPlan, generateInstagramContent, generateGooglePost, generateReviewReply } from "@/lib/claude"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { type, category, content_type, cta, topic, source } = await request.json()

    if (type === "content_plan") {
      if (!topic || !category || !content_type) {
        return NextResponse.json({ error: "topic, category and content_type required" }, { status: 400 })
      }
      const result = await generateContentPlan({
        topic,
        category,
        format: content_type,
        cta: cta ?? "Escribi TURNO y te paso como pedir turno",
        source,
      })
      return NextResponse.json(result)
    }

    if (type === "instagram") {
      if (!category || !content_type) {
        return NextResponse.json({ error: "category and content_type required" }, { status: 400 })
      }
      const result = await generateInstagramContent(category, content_type, cta ?? "Escribí TURNO")
      return NextResponse.json(result)
    }

    if (type === "google_post") {
      if (!topic) {
        return NextResponse.json({ error: "topic required" }, { status: 400 })
      }
      const text = await generateGooglePost(topic)
      return NextResponse.json({ text })
    }

    if (type === "review_reply") {
      if (!topic) {
        return NextResponse.json({ error: "topic required" }, { status: 400 })
      }
      const [starLine, ...rest] = topic.split(". ")
      const starRating = starLine.replace(" stars", "").trim().toUpperCase()
      const comment = rest.join(". ")
      const text = await generateReviewReply(starRating, comment)
      return NextResponse.json({ text })
    }

    return NextResponse.json({ error: "invalid content type" }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
