import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { CHANNEL_LABELS, SERVICE_LABELS, STATUS_LABELS, LOCATION_LABELS, type Lead } from "@/types"
import { escapeCsvCell } from "@/lib/csv"

// PostgREST (la API REST de Supabase) tiene un tope de filas por respuesta (db-max-rows, 1000 por
// default) que un select("*") sin range() respeta en silencio — si los leads reales superaran ese
// número, la exportación se truncaba sin ningún aviso. Se pagina con range() hasta agotar los
// resultados para que el CSV siempre incluya todos los leads, sin importar cuántos haya.
const EXPORT_PAGE_SIZE = 1000

async function fetchAllLeads(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ leads: Lead[]; error: string | null }> {
  const leads: Lead[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1)

    if (error) return { leads, error: error.message }
    leads.push(...((data ?? []) as Lead[]))
    if (!data || data.length < EXPORT_PAGE_SIZE) break
    from += EXPORT_PAGE_SIZE
  }
  return { leads, error: null }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { leads, error } = await fetchAllLeads(supabase)
  if (error) return NextResponse.json({ error }, { status: 500 })

  const headers = [
    "ID", "Nombre", "Teléfono", "Instagram", "Canal", "Servicio", "Ubicación", "Día",
    "Cobertura", "Estado", "Prioridad", "Confirmó turno", "Requiere humano",
    "Posible emergencia", "Campaña", "UTM source", "UTM medium", "UTM content",
    "Landing", "URL origen", "Mensaje", "Resumen IA", "Seguimiento hasta", "Creado",
  ]

  const rows = leads.map(l => [
    l.id,
    l.name,
    l.phone,
    l.instagram_username,
    CHANNEL_LABELS[l.origin_channel] ?? l.origin_channel,
    SERVICE_LABELS[l.requested_service] ?? l.requested_service,
    LOCATION_LABELS[l.preferred_location] ?? l.preferred_location,
    l.preferred_day,
    l.insurance,
    STATUS_LABELS[l.status] ?? l.status,
    String(l.priority_score),
    l.confirmed_booked ? "Sí" : "No",
    l.requires_human ? "Sí" : "No",
    l.possible_emergency ? "Sí" : "No",
    l.origin_campaign,
    l.utm_source,
    l.utm_medium,
    l.utm_content,
    l.landing_page,
    l.origin_url,
    l.last_message,
    l.ai_summary,
    l.followup_due_at ? new Date(l.followup_due_at).toLocaleString("es-AR") : "",
    new Date(l.created_at).toLocaleString("es-AR"),
  ].map(escapeCsvCell).join(","))

  const csv = [headers.join(","), ...rows].join("\r\n")
  const bom = "﻿"

  return new Response(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
