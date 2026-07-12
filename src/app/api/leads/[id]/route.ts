import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { leadFieldsSchema } from "@/lib/lead-schema"

async function getAuthedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return supabase
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getAuthedClient()
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

const PATCHABLE_FIELDS = new Set([
  "name", "phone", "instagram_username", "origin_channel", "origin_campaign",
  "searched_keyword", "insurance", "general_reason", "consent_to_contact",
  "requested_service", "preferred_location", "preferred_day", "status",
  "priority_score", "requires_human", "possible_emergency", "confirmed_booked",
  "ai_summary", "last_message", "followup_due_at", "referred_at",
  "utm_source", "utm_medium", "utm_campaign", "utm_content",
  "origin_url", "landing_page", "clicked_cimel_cta", "clicked_swiss_cta", "clicked_britanico_cta",
  "booking_instruction_viewed",
])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getAuthedClient()
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  if (typeof parsedBody.data !== "object" || parsedBody.data === null) {
    return NextResponse.json({ error: "El body debe ser un objeto JSON" }, { status: 400 })
  }
  const rawBody = parsedBody.data as Record<string, unknown>
  const candidate: Record<string, unknown> = {}
  for (const key of Object.keys(rawBody)) {
    if (PATCHABLE_FIELDS.has(key)) candidate[key] = rawBody[key]
  }

  const result = leadFieldsSchema.partial().safeParse(candidate)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const update: Record<string, unknown> = { ...result.data }

  // Auto-set followup_due_at when transitioning to seguimiento_pendiente without explicit date
  if (update.status === "seguimiento_pendiente" && !update.followup_due_at) {
    update.followup_due_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
