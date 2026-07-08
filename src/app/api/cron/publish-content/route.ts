import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/supabase/service"
import {
  readContentItems, writeContentItems, readAutoPublishSettings, writeAutoPublishSettings,
  shouldRunAutoPublish, isScheduledForFuture, pickNextPublishableItems, resolveChannelsToPublish,
  isRepeatDue,
} from "@/lib/content-pipeline"
import { generateContentVisual } from "@/lib/ai"
import { publishApprovedItem } from "@/lib/content-publish"
import { runWhatsAppFollowup } from "@/lib/whatsapp-followup"
import { sendCronFailureAlert } from "@/lib/alert-email"
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
  if (track.days_of_week.length === 0) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_no_days" }
  }
  if (!shouldRunAutoPublish(track, now)) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_interval" }
  }

  const items = await readContentItems(supabase)
  const candidates = pickNextPublishableItems(items, format, track.items_per_run, now)
  if (candidates.length === 0) {
    return { ...track, last_run_at: now.toISOString(), last_run_result: "skipped_no_item" }
  }

  let publishedCount = 0
  let lastIssue: string | null = null

  for (const candidate of candidates) {
    // Re-leer antes de cada pieza: mitiga la carrera con un click manual simultaneo y refleja lo
    // que ya se escribio de las piezas anteriores en esta misma corrida.
    const freshItems = await readContentItems(supabase)
    const current = freshItems.find(existing => existing.id === candidate.id)
    if (!current) continue
    // Piezas evergreen (repeat_interval_days) siguen "published" entre corridas: se re-publican
    // cuando vuelve a cumplirse el intervalo, ver isRepeatDue. El resto solo se toma si sigue "approved"
    // (evita publicar dos veces si se edito/publico a mano justo antes de esta corrida).
    const dueRepeat = current.status !== "approved" && isRepeatDue(current, now)
    if (current.status !== "approved" && !dueRepeat) continue
    // Al repetir, limpiar el resultado de la vuelta anterior: sin esto, resolveChannelsToPublish
    // ve auto_publish_result.instagram = "published" de la corrida pasada y no intenta publicar nada.
    if (dueRepeat) current.auto_publish_result = {}

    // Si la doctora ya genero la placa a mano al revisar la pieza, la reusamos tal cual (ahorra
    // cupo diario de IA y evita generar una imagen distinta a la que ella aprobo visualmente).
    let imageDataUrl: string | undefined
    if (!current.visual_url) {
      if (!current.image_prompt) {
        lastIssue = `error: item ${current.id} sin image_prompt`
        continue
      }
      try {
        const visual = await generateContentVisual({
          category: current.category,
          topic: current.topic,
          format: current.format,
          visual_headline: current.visual_headline,
          visual_subtitle: current.visual_subtitle,
          image_prompt: current.image_prompt,
        })
        imageDataUrl = `data:${visual.mime_type};base64,${visual.image_data}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith("DAILY_LIMIT_EXCEEDED")) {
          lastIssue = "quota_exceeded"
          break // sin cupo de imagenes no tiene sentido seguir probando el resto de las piezas hoy
        }
        lastIssue = `error: ${message}`
        continue
      }
    }

    const channelsToPublish = resolveChannelsToPublish(current, channels)
    const { item: nextItem, allPublished } = await publishApprovedItem(
      supabase, current, channelsToPublish, { instagramImageDataUrl: imageDataUrl }
    )
    await writeContentItems(supabase, freshItems.map(existing => existing.id === current.id ? nextItem : existing))
    if (allPublished) publishedCount++
  }

  const resultLabel = `published:${publishedCount}/${candidates.length}${lastIssue ? ` (${lastIssue})` : ""}`

  return {
    ...track,
    last_run_at: now.toISOString(),
    last_published_at: publishedCount > 0 ? now.toISOString() : track.last_published_at,
    last_run_result: resultLabel,
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const supabase = getServiceDb()
    const now = new Date()
    const settings = await readAutoPublishSettings(supabase)

    const post = await runTrack(supabase, "post", settings.post, settings.channels, now)
    const historia = await runTrack(supabase, "historia", settings.historia, settings.channels, now)

    await writeAutoPublishSettings(supabase, { ...settings, post, historia })

    // El seguimiento de WhatsApp corre acá adentro (en vez de tener su propio Vercel Cron) para no
    // sumar un tercer cron job -- el plan Hobby de Vercel limita a 2. Ver src/lib/whatsapp-followup.ts.
    const whatsappFollowup = await runWhatsAppFollowup(supabase, now)

    // Alerta por email (ver src/lib/alert-email.ts) solo ante fallos reales -- no ante estados
    // esperados (skipped_*, quota_exceeded) ni ante el aviso ya conocido de template sin aprobar.
    const failures: string[] = []
    if (post.last_run_result?.includes("(error:")) failures.push(`Posts: ${post.last_run_result}`)
    if (historia.last_run_result?.includes("(error:")) failures.push(`Historias: ${historia.last_run_result}`)
    const realWhatsappErrors = whatsappFollowup.errors.filter(e => !e.includes("todavía no está aprobado"))
    if (realWhatsappErrors.length > 0) failures.push(`Seguimiento WhatsApp: ${realWhatsappErrors.join("; ")}`)
    if (failures.length > 0) {
      await sendCronFailureAlert("publish-content", failures.join("\n"))
    }

    return NextResponse.json({ post: post.last_run_result, historia: historia.last_run_result, whatsappFollowup })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("publish-content", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
