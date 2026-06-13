import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { ContentItem } from "@/types"

const CONFIG_KEY = "content_pipeline"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 })
}

async function authenticatedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  return supabase
}

async function readItems() {
  const supabase = await authenticatedClient()
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle()

  if (error) throw error
  return Array.isArray(data?.value) ? data.value as ContentItem[] : []
}

async function writeItems(items: ContentItem[]) {
  const supabase = await authenticatedClient()
  const { error } = await supabase
    .from("app_config")
    .upsert({ key: CONFIG_KEY, value: items }, { onConflict: "key" })
  if (error) throw error
}

export async function GET() {
  try {
    return NextResponse.json({ items: await readItems() })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const incoming = await request.json() as ContentItem
    const topic = [incoming.topic, incoming.visual_headline, incoming.hook, incoming.category]
      .find(value => typeof value === "string" && value.trim())?.trim() || "Contenido generado"
    const category = typeof incoming.category === "string" && incoming.category.trim()
      ? incoming.category.trim()
      : "Contenido generado"
    const item = { ...incoming, topic: topic.slice(0, 200), category: category.slice(0, 160) }
    if (!item.id || typeof item.caption !== "string" || !item.caption.trim()) {
      return NextResponse.json({ error: "El borrador no tiene caption y no se puede guardar." }, { status: 400 })
    }
    const items = await readItems()
    await writeItems([item, ...items.filter(existing => existing.id !== item.id)].slice(0, 100))
    return NextResponse.json({ item })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Partial<ContentItem> & { id: string }
    const items = await readItems()
    const current = items.find(item => item.id === body.id)
    if (!current) return NextResponse.json({ error: "Borrador no encontrado" }, { status: 404 })

    const textFields: Array<keyof ContentItem> = [
      "hook", "caption", "google_text", "hashtags", "visual_headline", "visual_subtitle",
      "image_prompt", "image_alt_text",
    ]
    if (textFields.some(field => body[field] !== undefined && typeof body[field] !== "string")) {
      return NextResponse.json({ error: "Hay campos de texto invalidos" }, { status: 400 })
    }
    if (body.status && !["draft", "approved", "published", "archived"].includes(body.status)) {
      return NextResponse.json({ error: "Estado invalido" }, { status: 400 })
    }
    if (body.visual_style && !["rose", "blue", "teal"].includes(body.visual_style)) {
      return NextResponse.json({ error: "Estilo visual invalido" }, { status: 400 })
    }
    if ((body.google_text?.length ?? 0) > 1500 || (body.visual_headline?.length ?? 0) > 90 ||
      (body.visual_subtitle?.length ?? 0) > 90 || (body.image_prompt?.length ?? 0) > 2400 ||
      (body.image_alt_text?.length ?? 0) > 180) {
      return NextResponse.json({ error: "Uno o mas campos superan el limite permitido" }, { status: 400 })
    }
    if (body.slides && (!Array.isArray(body.slides) || body.slides.some(slide =>
      typeof slide?.headline !== "string" || typeof slide?.text !== "string" ||
      slide.headline.length > 60 || slide.text.length > 300
    ))) {
      return NextResponse.json({ error: "Slides invalidos" }, { status: 400 })
    }

    const now = new Date().toISOString()
    const editableFields: Array<keyof ContentItem> = [
      "status",
      "hook",
      "caption",
      "google_text",
      "hashtags",
      "visual_headline",
      "visual_subtitle",
      "visual_style",
      "image_prompt",
      "image_alt_text",
      "slides",
    ]
    const changes = Object.fromEntries(
      editableFields
        .filter(field => body[field] !== undefined)
        .map(field => [field, body[field]])
    ) as Partial<ContentItem>
    const hasContentChanges = editableFields.some(field => field !== "status" && body[field] !== undefined)
    const resetApproval = hasContentChanges && !body.status && ["approved", "published"].includes(current.status)
    const nextItem = {
      ...current,
      ...changes,
      ...(resetApproval ? { status: "draft" as const } : {}),
      updated_at: now,
      approved_at: body.status === "approved" ? now : resetApproval ? null : current.approved_at,
    }
    if (nextItem.status === "approved" && [
      nextItem.hook, nextItem.caption, nextItem.google_text, nextItem.visual_headline,
    ].some(value => !value.trim())) {
      return NextResponse.json({ error: "Completá hook, caption, texto de Google y titular visual antes de aprobar" }, { status: 400 })
    }

    const updated = items.map(item => item.id === body.id ? nextItem : item)
    await writeItems(updated)
    return NextResponse.json({ item: nextItem })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    await writeItems((await readItems()).filter(item => item.id !== id))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
