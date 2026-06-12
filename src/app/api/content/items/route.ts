import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import type { ContentItem, ContentStatus } from "@/types"

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
    const item = await request.json() as ContentItem
    if (!item.id || !item.caption || !item.topic) {
      return NextResponse.json({ error: "Borrador incompleto" }, { status: 400 })
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
    const body = await request.json() as {
      id: string
      status?: ContentStatus
      caption?: string
      google_text?: string
    }
    const items = await readItems()
    const now = new Date().toISOString()
    const updated = items.map(item => item.id === body.id ? {
      ...item,
      ...(body.status ? { status: body.status } : {}),
      ...(body.caption !== undefined ? { caption: body.caption } : {}),
      ...(body.google_text !== undefined ? { google_text: body.google_text } : {}),
      updated_at: now,
      approved_at: body.status === "approved" ? now : item.approved_at,
    } : item)
    await writeItems(updated)
    return NextResponse.json({ item: updated.find(item => item.id === body.id) })
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
