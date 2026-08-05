import type { SupabaseClient } from "@supabase/supabase-js"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { snapshotContentInsights } from "@/lib/content-insights"
import { snapshotGoogleBusinessMetrics } from "@/lib/google-performance"
import { checkWhatsAppCloudApiConfiguration } from "@/lib/whatsapp"
import { runWhatsAppFollowup } from "@/lib/whatsapp-followup"
import { runHandoffReminderCheck } from "@/lib/whatsapp-handoff"
import { drainWhatsAppInboundQueue, getWhatsAppQueueHealth } from "@/lib/whatsapp-inbound-queue"
import { snapshotInstagramFollowers } from "@/lib/instagram-followers"

export async function runDailyMaintenance(supabase: SupabaseClient, now: Date) {
  let whatsappQueue = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 }
  let whatsappQueueError = false
  try {
    whatsappQueue = await drainWhatsAppInboundQueue({ maxEvents: 200, timeBudgetMs: 120_000 })
  } catch {
    whatsappQueueError = true
  }

  let whatsappQueueHealth = { deadLetterCount: 0, dueCount: 0 }
  let whatsappQueueHealthError = false
  try {
    whatsappQueueHealth = await getWhatsAppQueueHealth(now)
  } catch {
    whatsappQueueHealthError = true
  }

  const whatsappMetaPreflight = await checkWhatsAppCloudApiConfiguration()
  const whatsappFollowup = await runWhatsAppFollowup(supabase, now)
  const handoffReminder = await runHandoffReminderCheck(now)
  const instagramFollowers = await snapshotInstagramFollowers(supabase, now)
  const contentInsights = await snapshotContentInsights(supabase, now)
  const googleBusinessMetrics = await snapshotGoogleBusinessMetrics(supabase, now)

  const failures: string[] = []
  const realWhatsappErrors = whatsappFollowup.errors.filter(error => !error.includes("todavía no está aprobado"))
  if (realWhatsappErrors.length > 0) failures.push(`Seguimiento WhatsApp: ${realWhatsappErrors.join("; ")}`)
  if (instagramFollowers.error) failures.push(`Seguidores de Instagram: ${instagramFollowers.error}`)
  if (contentInsights.error) failures.push(`Insights de contenido: ${contentInsights.error}`)
  if (googleBusinessMetrics.error) failures.push(`Métricas de Google Business: ${googleBusinessMetrics.error}`)
  if (handoffReminder.error) failures.push(`Recordatorio de derivación a humano: ${handoffReminder.error}`)
  if (whatsappQueueError) failures.push("Cola WhatsApp: worker_unavailable")
  if (whatsappQueueHealthError) failures.push("Cola WhatsApp: health_check_failed")
  if (whatsappQueueHealth.deadLetterCount > 0) {
    failures.push(`Cola WhatsApp: ${whatsappQueueHealth.deadLetterCount} evento(s) en dead-letter`)
  }
  if (whatsappQueueHealth.dueCount > 0) {
    failures.push(`Cola WhatsApp: ${whatsappQueueHealth.dueCount} evento(s) vencido(s) pendiente(s)`)
  }
  if (!whatsappMetaPreflight.ok) failures.push(`WhatsApp Meta: preflight_${whatsappMetaPreflight.code}`)
  if (failures.length > 0) await sendCronFailureAlert("daily-maintenance", failures.join("\n"))

  return {
    whatsappFollowup,
    instagramFollowers,
    contentInsights,
    googleBusinessMetrics,
    handoffReminder,
    whatsappQueue,
    whatsappQueueHealth,
    whatsappMetaPreflight,
  }
}
