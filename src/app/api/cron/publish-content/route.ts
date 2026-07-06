import { NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import {
  readContentItems, writeContentItems, readAutoPublishSettings, writeAutoPublishSettings,
  shouldRunAutoPublish, pickNextPublishableItem, resolveChannelsToPublish,
} from "@/lib/content-pipeline"
import { generateContentVisual } from "@/lib/ai"
import { publishImageToInstagram } from "@/lib/instagram-business"
import { createGoogleBusinessPost } from "@/lib/google-business"
import type { ContentItem } from "@/types"

export const maxDuration = 120

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed: sin secreto configurado, no se ejecuta nada
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
  const now = new Date()
  const settings = await readAutoPublishSettings(supabase)

  if (!settings.enabled) {
    await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: "skipped_disabled" })
    return NextResponse.json({ result: "skipped_disabled" })
  }
  if (!shouldRunAutoPublish(settings, now)) {
    await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: "skipped_interval" })
    return NextResponse.json({ result: "skipped_interval" })
  }

  const items = await readContentItems(supabase)
  const item = pickNextPublishableItem(items)
  if (!item) {
    await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: "skipped_no_item" })
    return NextResponse.json({ result: "skipped_no_item" })
  }

  // Si la doctora ya genero la placa a mano al revisar la pieza, la reusamos tal cual (ahorra
  // cupo diario de IA y evita generar una imagen distinta a la que ella aprobo visualmente).
  let imageDataUrl: string | undefined
  const imageUrl: string | undefined = item.visual_url

  if (!imageUrl) {
    if (!item.image_prompt) {
      await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: `error: item ${item.id} sin image_prompt` })
      return NextResponse.json({ result: "error", message: "El item elegido no tiene image_prompt, no se puede generar la placa" }, { status: 200 })
    }
    try {
      const visual = await generateContentVisual({
        category: item.category,
        topic: item.topic,
        format: item.format,
        visual_headline: item.visual_headline,
        visual_subtitle: item.visual_subtitle,
        image_prompt: item.image_prompt,
      })
      imageDataUrl = `data:${visual.mime_type};base64,${visual.image_data}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("DAILY_LIMIT_EXCEEDED")) {
        await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: "quota_exceeded" })
        return NextResponse.json({ result: "quota_exceeded" })
      }
      await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: `error: ${message}` })
      return NextResponse.json({ result: "error", message }, { status: 200 })
    }
  }

  // Re-chequear el estado justo antes de publicar: mitiga la carrera con un click manual simultaneo.
  const freshItems = await readContentItems(supabase)
  const current = freshItems.find(existing => existing.id === item.id)
  if (!current || current.status !== "approved") {
    await writeAutoPublishSettings(supabase, { ...settings, last_run_at: now.toISOString(), last_run_result: "skipped_race" })
    return NextResponse.json({ result: "skipped_race" })
  }

  const channelsToPublish = resolveChannelsToPublish(current, settings)
  const result: NonNullable<ContentItem["auto_publish_result"]> = { ...current.auto_publish_result }

  if (channelsToPublish.includes("instagram")) {
    try {
      await publishImageToInstagram(supabase, {
        itemId: current.id, imageUrl, imageDataUrl, caption: current.caption, format: current.format,
      })
      result.instagram = "published"
    } catch {
      result.instagram = "error"
    }
  }
  if (channelsToPublish.includes("google_business")) {
    try {
      await createGoogleBusinessPost(supabase, { summary: current.google_text })
      result.google_business = "published"
    } catch {
      result.google_business = "error"
    }
  }

  const allPublished = channelsToPublish.every(channel => result[channel] === "published")
  const nextItem: ContentItem = {
    ...current,
    auto_publish_result: result,
    status: allPublished ? "published" : current.status,
    updated_at: now.toISOString(),
  }
  await writeContentItems(supabase, freshItems.map(existing => existing.id === current.id ? nextItem : existing))
  await writeAutoPublishSettings(supabase, {
    ...settings,
    last_run_at: now.toISOString(),
    last_published_at: allPublished ? now.toISOString() : settings.last_published_at,
    last_run_result: allPublished ? "published" : "partial",
  })

  return NextResponse.json({ result: allPublished ? "published" : "partial", itemId: current.id, auto_publish_result: result })
}
