import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/supabase/service"
import { sendCronFailureAlert } from "@/lib/alert-email"
import { runDataRetentionSweep } from "@/lib/data-retention"

export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed: sin secreto configurado, no se ejecuta nada
  return request.headers.get("authorization") === `Bearer ${secret}`
}

async function countLeads(supabase: SupabaseClient, from: string, to: string, filter: Record<string, string | boolean> = {}) {
  let query = supabase.from("leads").select("id", { count: "exact", head: true })
    .gte("created_at", from).lt("created_at", to)
  for (const [key, value] of Object.entries(filter)) {
    query = query.eq(key, value)
  }
  const { count } = await query
  return count ?? 0
}

async function countEvents(supabase: SupabaseClient, from: string, to: string, eventTypes: string[]) {
  const { count } = await supabase.from("landing_events").select("id", { count: "exact", head: true })
    .gte("created_at", from).lt("created_at", to)
    .in("event_type", eventTypes)
  return count ?? 0
}

// Genera un snapshot semanal (leads nuevos, conversion, canales, sedes, visitas de landing) y lo
// guarda en weekly_reports para verlo en el Dashboard. El contenido del reporte no se manda por
// WhatsApp/email de forma proactiva -- ese canal no existe todavia para WhatsApp (requeriria un
// template aprobado por Meta, ver CLAUDE.md), asi que el reporte queda disponible en la app en vez
// de enviarse solo. Si el cron en si falla, sí manda un email de alerta (ver alert-email.ts).
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    return await buildAndSaveWeeklyReport()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sendCronFailureAlert("weekly-report", `Excepción no controlada: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function buildAndSaveWeeklyReport() {
  const supabase = getServiceDb()
  const now = new Date()
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

  if (error) {
    await sendCronFailureAlert("weekly-report", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Barrida de retención de datos (DATA-02) — corre acá adentro para no sumar un tercer cron job
  // de Vercel (el plan Hobby limita a 2, ver whatsapp-followup.ts para el mismo patrón). Cadencia
  // semanal de sobra para un umbral de 24 meses de inactividad.
  let retention: Awaited<ReturnType<typeof runDataRetentionSweep>> | { errors: string[] }
  try {
    retention = await runDataRetentionSweep(supabase)
  } catch {
    retention = { errors: ["retention_sweep_failed"] }
  }
  if (retention.errors.length > 0) {
    await sendCronFailureAlert("weekly-report", `Barrida de retención de datos: ${retention.errors.join("; ")}`)
  }

  return NextResponse.json({ ok: true, metrics, retention })
}
