import { NextResponse } from "next/server"
import { generateInstagramContent, generateGooglePost } from "@/lib/claude"

export async function POST(request: Request) {
  const { type, category, content_type, cta, topic } = await request.json()

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

  return NextResponse.json({ error: "type must be instagram or google_post" }, { status: 400 })
}
