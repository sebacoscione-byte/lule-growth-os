import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
import type { ContentItem } from "@/types"

const INTERACTION_EVENT_TYPES = new Set(["click_booking", "click_call", "click_whatsapp", "click_maps"])

async function readAttribution(supabase: SupabaseClient, itemIds: string[]) {
  const attribution: Record<string, { visits: number; interactions: number }> = {}
  if (itemIds.length === 0) return attribution
  const { data } = await supabase
    .from("landing_events")
    .select("utm_content, event_type")
    .in("utm_content", itemIds)
  for (const row of data ?? []) {
    if (!row.utm_content) continue
    const entry = attribution[row.utm_content] ?? { visits: 0, interactions: 0 }
    if (row.event_type === "page_view") entry.visits += 1
    else if (INTERACTION_EVENT_TYPES.has(row.event_type)) entry.interactions += 1
    attribution[row.utm_content] = entry
  }
  return attribution
}

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
  return readContentItems(await authenticatedClient())
}

async function writeItems(items: ContentItem[]) {
  await writeContentItems(await authenticatedClient(), items)
}

export async function GET() {
  try {
    const supabase = await authenticatedClient()
    const items = await readContentItems(supabase)
    const attribution = await readAttribution(supabase, items.map(item => item.id))
    const itemsWithAttribution = items.map(item => ({
      ...item,
      tracked_visits: attribution[item.id]?.visits ?? 0,
      tracked_interactions: attribution[item.id]?.interactions ?? 0,
    }))
    return NextResponse.json({ items: itemsWithAttribution })
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
    if (!item.id || typeof item.caption !== "string") {
      return NextResponse.json({ error: "Falta el id de la pieza." }, { status: 400 })
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
      "image_prompt", "image_alt_text", "visual_url",
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
    if (body.auto_publish_result !== undefined) {
      const validKeys = ["instagram", "google_business"]
      const validValues = ["published", "error"]
      const valid = typeof body.auto_publish_result === "object" && body.auto_publish_result !== null &&
        Object.entries(body.auto_publish_result).every(([key, value]) => validKeys.includes(key) && validValues.includes(value as string))
      if (!valid) return NextResponse.json({ error: "Resultado de publicacion invalido" }, { status: 400 })
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
      "visual_url",
      "auto_publish_result",
    ]
    const changes = Object.fromEntries(
      editableFields
        .filter(field => body[field] !== undefined)
        .map(field => [field, body[field]])
    ) as Partial<ContentItem>
    // visual_url y auto_publish_result no cuentan como "edicion de contenido": adjuntar la placa
    // generada o limpiar el resultado de publicacion (deshacer) no debe resetear a borrador.
    const hasContentChanges = editableFields.some(field =>
      field !== "status" && field !== "visual_url" && field !== "auto_publish_result" && body[field] !== undefined
    )
    const resetApproval = hasContentChanges && !body.status && ["approved", "published"].includes(current.status)
    const nextItem = {
      ...current,
      ...changes,
      ...(resetApproval ? { status: "draft" as const } : {}),
      updated_at: now,
      approved_at: body.status === "approved" ? now : resetApproval ? null : current.approved_at,
    }
    if (nextItem.status === "approved" && (
      [nextItem.hook, nextItem.caption, nextItem.google_text].some(value => !value.trim()) ||
      (!nextItem.visual_headline.trim() && !nextItem.visual_url)
    )) {
      return NextResponse.json({ error: "Completá hook, caption y texto de Google, y agregá un titular visual o subí una imagen propia antes de aprobar" }, { status: 400 })
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
