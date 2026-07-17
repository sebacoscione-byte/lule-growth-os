import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { sanitizePostgrestValue } from "@/lib/utils"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { leadFieldsSchema } from "@/lib/lead-schema"
import { getOpenHandoffs } from "@/lib/whatsapp-handoff"
import { authorizeStaff } from "@/lib/staff-authz"
import type { Lead } from "@/types"

const PATIENT_DATA_ROLES = ["owner", "doctor", "reception"] as const

export async function GET(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PATIENT_DATA_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const channel = searchParams.get("channel")
  const service = searchParams.get("service")
  const q = searchParams.get("q")
  const requiresHuman = searchParams.get("requires_human")

  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300)

  if (status) query = query.eq("status", status)
  if (channel) query = query.eq("origin_channel", channel)
  if (service) query = query.eq("requested_service", service)
  if (requiresHuman === "true") query = query.eq("requires_human", true)
  if (q) {
    const safeQ = sanitizePostgrestValue(q)
    if (safeQ) query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,instagram_username.ilike.%${safeQ}%`)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Ola 4 (P2, incidente real 2026-07-14): el Inbox usa esta ruta sin filtros para armar la lista
  // de conversaciones -- los leads que están esperando a una persona del equipo se muestran primero,
  // ordenados por el que espera hace más tiempo, en vez de mezclados por fecha de creación del lead.
  const leads = (data ?? []) as Lead[]
  const pendingIds = leads.filter(l => l.requires_human).map(l => l.id)
  const openHandoffs = pendingIds.length > 0 ? await getOpenHandoffs(pendingIds) : new Map()

  const withWait = leads.map(l => ({
    ...l,
    handoff_waiting_since: openHandoffs.get(l.id)?.takenAt
      ? null
      : openHandoffs.get(l.id)?.createdAt ?? null,
    handoff_taken_at: openHandoffs.get(l.id)?.takenAt ?? null,
    handoff_patient_replied_at: openHandoffs.get(l.id)?.patientRepliedAt ?? null,
  }))
  withWait.sort((a, b) => {
    if (a.handoff_waiting_since && b.handoff_waiting_since) {
      return new Date(a.handoff_waiting_since).getTime() - new Date(b.handoff_waiting_since).getTime()
    }
    if (a.handoff_waiting_since) return -1
    if (b.handoff_waiting_since) return 1
    if (a.handoff_patient_replied_at && b.handoff_patient_replied_at) {
      return new Date(b.handoff_patient_replied_at).getTime() - new Date(a.handoff_patient_replied_at).getTime()
    }
    if (a.handoff_patient_replied_at) return -1
    if (b.handoff_patient_replied_at) return 1
    return 0 // Array.prototype.sort es estable: conserva el orden por created_at desc ya traído.
  })

  return NextResponse.json(withWait)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PATIENT_DATA_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = leadFieldsSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const body = result.data

  const allowed = {
    name: body.name ?? null,
    phone: body.phone ?? null,
    instagram_username: body.instagram_username ?? null,
    origin_channel: body.origin_channel ?? "manual",
    origin_campaign: body.origin_campaign ?? null,
    searched_keyword: body.searched_keyword ?? null,
    insurance: body.insurance ?? null,
    general_reason: body.general_reason ?? null,
    consent_to_contact: body.consent_to_contact ?? false,
    requested_service: body.requested_service ?? "no_definido",
    preferred_location: body.preferred_location ?? "sin_definir",
    preferred_day: body.preferred_day ?? "sin_definir",
    status: body.status ?? "nuevo",
    priority_score: body.priority_score ?? 5,
    requires_human: body.requires_human ?? false,
    possible_emergency: body.possible_emergency ?? false,
    confirmed_booked: body.confirmed_booked ?? false,
    ai_summary: body.ai_summary ?? null,
    last_message: body.last_message ?? null,
    followup_due_at: body.followup_due_at ?? null,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    utm_content: body.utm_content ?? null,
    origin_url: body.origin_url ?? null,
    landing_page: body.landing_page ?? null,
  }

  const { data, error } = await supabase
    .from("leads")
    .insert([allowed])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
