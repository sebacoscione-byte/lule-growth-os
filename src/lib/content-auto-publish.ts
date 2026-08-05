import type { SupabaseClient } from "@supabase/supabase-js"
import { generateContentVisual } from "@/lib/ai"
import {
  alreadyPublishedToday,
  isRepeatDue,
  isScheduledForFuture,
  isTodayScheduledDay,
  isWithinScheduledWindow,
  pickNextPublishableItems,
  readAutoPublishSettings,
  readContentItems,
  resolveChannelsToPublish,
  shouldRunAutoPublish,
  writeAutoPublishSettings,
  writeContentItems,
} from "@/lib/content-pipeline"
import { publishApprovedItem } from "@/lib/content-publish"
import type { AutoPublishFormat } from "@/lib/content-pipeline"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem } from "@/types"

export type AutoPublishRunResults = Partial<Record<AutoPublishFormat, AutoPublishTrackSettings>>

export function getPublishReadinessIssue(item: ContentItem, format: AutoPublishFormat): string | null {
  if (format === "carrusel") {
    const missingSlideImages = (item.slides ?? []).some(slide => !slide.visual_url)
    if (!item.visual_url || missingSlideImages) return `item ${item.id} sin todas las placas del carrusel generadas`
    return null
  }
  if (format === "reel") return item.video_url ? null : `item ${item.id} sin video subido`
  if (!item.visual_url && !item.image_prompt) return `item ${item.id} sin image_prompt`
  return null
}

export async function runAutoPublishTrack(
  supabase: SupabaseClient,
  format: AutoPublishFormat,
  track: AutoPublishTrackSettings,
  channels: ContentChannel[],
  now: Date
): Promise<AutoPublishTrackSettings> {
  const attempted = { ...track, last_run_at: now.toISOString() }
  if (!track.enabled) return { ...attempted, last_run_result: "skipped_disabled" }
  if (isScheduledForFuture(track, now)) return { ...attempted, last_run_result: "skipped_scheduled" }
  if (track.schedule_slots.length === 0) return { ...attempted, last_run_result: "skipped_no_slots" }
  if (!isTodayScheduledDay(track, now)) return { ...attempted, last_run_result: "skipped_not_scheduled_day" }
  if (!isWithinScheduledWindow(track, now)) return { ...attempted, last_run_result: "skipped_outside_window" }
  if (alreadyPublishedToday(track, now)) return { ...attempted, last_run_result: "skipped_already_published" }

  const items = await readContentItems(supabase)
  const candidates = pickNextPublishableItems(items, format, track.items_per_run, now)
  if (candidates.length === 0) return { ...attempted, last_run_result: "skipped_no_item" }

  let publishedCount = 0
  let lastIssue: string | null = null

  for (const candidate of candidates) {
    // Releer antes de cada pieza conserva el resguardo existente ante un click manual o un retry
    // que haya actualizado la cola mientras esta corrida seguía viva.
    const freshItems = await readContentItems(supabase)
    const current = freshItems.find(existing => existing.id === candidate.id)
    if (!current) continue
    const dueRepeat = current.status !== "approved" && isRepeatDue(current, now)
    if (current.status !== "approved" && !dueRepeat) continue
    if (dueRepeat) current.auto_publish_result = {}

    const readinessIssue = getPublishReadinessIssue(current, format)
    if (readinessIssue) {
      lastIssue = `error: ${readinessIssue}`
      continue
    }

    let imageDataUrl: string | undefined
    if (format !== "carrusel" && format !== "reel" && !current.visual_url) {
      try {
        const visual = await generateContentVisual({
          category: current.category,
          topic: current.topic,
          format: current.format,
          visual_headline: current.visual_headline,
          visual_subtitle: current.visual_subtitle,
          image_prompt: current.image_prompt as string,
          version: current.visual_generation_version,
        })
        imageDataUrl = `data:${visual.mime_type};base64,${visual.image_data}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith("DAILY_LIMIT_EXCEEDED")) {
          lastIssue = "quota_exceeded"
          break
        }
        lastIssue = `error: ${message}`
        continue
      }
    }

    const channelsToPublish = resolveChannelsToPublish(current, channels)
    const { item: nextItem, allPublished } = await publishApprovedItem(
      supabase,
      current,
      channelsToPublish,
      { instagramImageDataUrl: imageDataUrl }
    )
    const persistItem = dueRepeat && allPublished
      ? { ...nextItem, repeat_count: (current.repeat_count ?? 0) + 1 }
      : nextItem
    await writeContentItems(
      supabase,
      freshItems.map(existing => existing.id === current.id ? persistItem : existing)
    )
    if (allPublished) publishedCount++
  }

  return {
    ...attempted,
    last_published_at: publishedCount > 0 ? now.toISOString() : track.last_published_at,
    last_run_result: `published:${publishedCount}/${candidates.length}${lastIssue ? ` (${lastIssue})` : ""}`,
  }
}

/** Ejecuta y persiste solo los formatos pedidos. En feed, una publicación exitosa bloquea las
 * siguientes del mismo día aun si una configuración legacy superponía tracks. */
export async function runAutoPublishFormats(
  supabase: SupabaseClient,
  formats: AutoPublishFormat[],
  now: Date
): Promise<AutoPublishRunResults> {
  const settings = await readAutoPublishSettings(supabase)
  const next: AutoPublishSettings = { ...settings }
  const results: AutoPublishRunResults = {}
  let feedAlreadyPublished = false

  for (const format of formats) {
    const track = settings[format]
    let result: AutoPublishTrackSettings
    if (format !== "historia" && feedAlreadyPublished && shouldRunAutoPublish(track, now)) {
      result = { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_feed_conflict" }
    } else {
      result = await runAutoPublishTrack(supabase, format, track, settings.channels, now)
    }
    if (format !== "historia" && result.last_published_at !== track.last_published_at) {
      feedAlreadyPublished = true
    }
    next[format] = result
    results[format] = result
  }

  await writeAutoPublishSettings(supabase, next)
  return results
}
