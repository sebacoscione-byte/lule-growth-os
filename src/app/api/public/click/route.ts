import { getServiceDb } from "@/lib/supabase/service"
import { NextResponse } from "next/server"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

const VALID_EVENT_TYPES = new Set([
  "cta_cimel", "cta_swiss", "cta_britanico", "instructions_viewed", "form_started", "form_submitted",
  "page_view", "click_booking", "click_call", "click_whatsapp", "click_maps",
])

const VALID_LOCATION_KEYS = new Set(["cimel", "swiss", "britanico"])

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const { allowed } = checkRateLimit(`click:${ip}`, 30, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const body = await request.json()
  const { event_type, slug, location_key, utm_source, utm_medium, utm_campaign, utm_content } = body

  if (!event_type || !slug || !VALID_EVENT_TYPES.has(event_type)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }
  if (location_key !== undefined && location_key !== null && !VALID_LOCATION_KEYS.has(location_key)) {
    return NextResponse.json({ error: "Invalid location_key" }, { status: 400 })
  }

  const supabase = getServiceDb()
  await supabase.from("landing_events").insert({
    event_type,
    slug,
    location_key: location_key ?? null,
    utm_source: utm_source ?? null,
    utm_medium: utm_medium ?? null,
    utm_campaign: utm_campaign ?? null,
    utm_content: utm_content ?? null,
  })

  return NextResponse.json({ ok: true })
}
