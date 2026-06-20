import { createServiceClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const VALID_EVENT_TYPES = new Set([
  "cta_cimel", "cta_swiss", "instructions_viewed", "form_started", "form_submitted",
])

export async function POST(request: Request) {
  const body = await request.json()
  const { event_type, slug, utm_source, utm_medium, utm_campaign } = body

  if (!event_type || !slug || !VALID_EVENT_TYPES.has(event_type)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }

  const supabase = await createServiceClient()
  await supabase.from("landing_events").insert({
    event_type,
    slug,
    utm_source: utm_source ?? null,
    utm_medium: utm_medium ?? null,
    utm_campaign: utm_campaign ?? null,
  })

  return NextResponse.json({ ok: true })
}
