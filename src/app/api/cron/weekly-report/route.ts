import type { SupabaseClient } from "@supabase/supabase-js"
import { handleCronRequest } from "@/lib/cron-runner"
import { runDataRetentionSweep } from "@/lib/data-retention"

export const maxDuration = 180

async function countLeads(
  supabase: SupabaseClient,
  from: string,
  to: string,
  filter: Record<string, string | boolean> = {}
) {
  let query = supabase.from("leads").select("id", { count: "exact", head: true })
    .gte("created_at", from).lt("created_at", to)
  for (const [key, value] of Object.entries(filter)) query = query.eq(key, value)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

async function countEvents(supabase: SupabaseClient, from: string, to: string, eventTypes: string[]) {
  const { count, error } = await supabase.from("landing_events").select("id", { count: "exact", head: true })
    .gte("created_at", from).lt("created_at", to)
    .in("event_type", eventTypes)
  if (error) throw error
  return count ?? 0
}

export async function buildAndSaveWeeklyReport(supabase: SupabaseClient, now: Date) {
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const from = weekStart.toISOString()
  const to = now.toISOString()

  const [
    leads_total, leads_confirmed, leads_requires_human, leads_emergencies,
    google_maps, google_search, instagram, whatsapp, manual,
    derivado_cimel, derivado_swiss, derivado_britanico,
    landing_visits, landing_interactions,
  ] = await Promise.all([
    countLeads(supabase, from, to),
    countLeads(supabase, from, to, { confirmed_booked: true }),
    countLeads(supabase, from, to, { requires_human: true }),
    countLeads(supabase, from, to, { possible_emergency: true }),
    countLeads(supabase, from, to, { origin_channel: "google_maps" }),
    countLeads(supabase, from, to, { origin_channel: "google_search" }),
    countLeads(supabase, from, to, { origin_channel: "instagram" }),
    countLeads(supabase, from, to, { origin_channel: "whatsapp" }),
    countLeads(supabase, from, to, { origin_channel: "manual" }),
    countLeads(supabase, from, to, { status: "derivado_cimel" }),
    countLeads(supabase, from, to, { status: "derivado_swiss" }),
    countLeads(supabase, from, to, { status: "derivado_britanico" }),
    countEvents(supabase, from, to, ["page_view"]),
    countEvents(supabase, from, to, ["click_booking", "click_call", "click_whatsapp", "click_maps"]),
  ])

  const metrics = {
    leads_total,
    leads_confirmed,
    leads_requires_human,
    leads_emergencies,
    conversion_rate: leads_total > 0 ? Math.round((leads_confirmed / leads_total) * 100) : 0,
    by_channel: { google_maps, google_search, instagram, whatsapp, manual },
    by_location: { cimel: derivado_cimel, swiss: derivado_swiss, britanico: derivado_britanico },
    landing_visits,
    landing_interactions,
  }

  const { error } = await supabase.from("weekly_reports").upsert({
    week_start: weekStart.toISOString().slice(0, 10),
    week_end: now.toISOString().slice(0, 10),
    metrics,
  }, { onConflict: "week_start" })
  if (error) throw error

  let retention: Awaited<ReturnType<typeof runDataRetentionSweep>> | { errors: string[] }
  try {
    retention = await runDataRetentionSweep(supabase)
  } catch {
    retention = { errors: ["retention_sweep_failed"] }
  }

  return { metrics, retention }
}

// El snapshot semanal usa upsert por semana y la barrida de retención es idempotente. Por eso una
// falla parcial puede reintentarse de forma segura desde el scheduler de respaldo.
export async function GET(request: Request) {
  return handleCronRequest(request, {
    jobName: "weekly-report",
    task: async (supabase, now) => {
      const result = await buildAndSaveWeeklyReport(supabase, now)
      return {
        status: result.retention.errors.length > 0 ? "failed" : "succeeded",
        payload: { ok: result.retention.errors.length === 0, ...result },
        summary: result.retention.errors.length > 0
          ? `Barrida de retención: ${result.retention.errors.join("; ")}`
          : "Reporte semanal y retención completados",
      }
    },
  })
}
