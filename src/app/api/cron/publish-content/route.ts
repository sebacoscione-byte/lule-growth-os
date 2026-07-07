import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/supabase/service"
import {
  readContentItems, writeContentItems, readAutoPublishSettings, writeAutoPublishSettings,
  shouldRunAutoPublish, isScheduledForFuture, pickNextPublishableItem, resolveChannelsToPublish,
} from "@/lib/content-pipeline"
import { generateContentVisual } from "@/lib/ai"
import { publishApprovedItem } from "@/lib/content-publish"
import type { AutoPublishTrackSettings, ContentChannel } from "@/types"

export const maxDuration = 180

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed: sin secreto configurado, no se ejecuta nada
  return request.headers.get("authorization") === `Bearer ${secret}`
}

async function runTrack(
  supabase: SupabaseClient,
  format: "post" | "historia",
  track: AutoPublishTrackSettings,
  channels: ContentChannel[],
  now: Date
): Promise<AutoPublishTrackSettings> {
  if (!track.enabled) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_disabled" }
  }
  if (isScheduledForFuture(track, now)) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_scheduled" }
  }
  if (!shouldRunAutoPublish(track, now)) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_interval" }
  }

  const items = await readContentItems(supabase)
  const item = pickNextPublishableItem(items, format)
  if (!item) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_no_item" }
  }

  // Si la doctora ya genero la placa a mano al revisar la pieza, la reusamos tal cual (ahorra
  // cupo diario de IA y evita generar una imagen distinta a la que ella aprobo visualmente).
  let imageDataUrl: string | undefined
  if (!item.visual_url) {
    if (!item.image_prompt) {
      return { ...track, last_run_at: now.toISOString(), last_run_result: `error: item ${item.id} sin image_prompt` }
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
        return { ...track, last_run_at: now.toISOString(), last_run_result: "quota_exceeded" }
      }
      return { ...track, last_run_at: now.toISOString(), last_run_result: `error: ${message}` }
    }
  }

  // Re-chequear el estado justo antes de publicar: mitiga la carrera con un click manual simultaneo.
  const freshItems = await readContentItems(supabase)
  const current = freshItems.find(existing => existing.id === item.id)
  if (!current || current.status !== "approved") {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_race" }
  }

  const channelsToPublish = resolveChannelsToPublish(current, channels)
  const { item: nextItem, allPublished } = await publishApprovedItem(
    supabase, current, channelsToPublish, { instagramImageDataUrl: imageDataUrl }
  )
  await writeContentItems(supabase, freshItems.map(existing => existing.id === current.id ? nextItem : existing))

  return {
    ...track,
    last_run_at: now.toISOString(),
    last_published_at: allPublished ? now.toISOString() : track.last_published_at,
    last_run_result: allPublished ? "published" : "partial",
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
  const now = new Date()
  const settings = await readAutoPublishSettings(supabase)

  const post = await runTrack(supabase, "post", settings.post, settings.channels, now)
  const historia = await runTrack(supabase, "historia", settings.historia, settings.channels, now)

  await writeAutoPublishSettings(supabase, { ...settings, post, historia })

  return NextResponse.json({ post: post.last_run_result, historia: historia.last_run_result })
}
