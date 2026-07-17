import { getServiceDb } from "@/lib/supabase/service"
import { NextResponse } from "next/server"
import { z } from "zod"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

const EVENT_TYPES = [
  "cta_cimel", "cta_swiss", "cta_britanico", "instructions_viewed", "form_started", "form_submitted",
  "page_view", "click_booking", "click_call", "click_whatsapp", "click_maps",
  "click_hero_primary", "click_hero_secondary", "click_instagram",
] as const

const clickEventSchema = z.object({
  event_type: z.enum(EVENT_TYPES),
  slug: z.enum(PUBLIC_LANDING_SLUGS as [string, ...string[]]),
  location_key: z.enum(["cimel", "swiss", "britanico"]).optional().nullable(),
  variant: z.enum(["a", "b"]).optional().nullable(),
  utm_source: z.string().trim().max(200).optional().nullable(),
  utm_medium: z.string().trim().max(200).optional().nullable(),
  utm_campaign: z.string().trim().max(200).optional().nullable(),
  utm_content: z.string().trim().max(200).optional().nullable(),
  session_id: z.string().uuid().optional().nullable(),
})

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const { allowed } = await checkRateLimit(`click:${ip}`, 30, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = clickEventSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const {
    event_type, slug, location_key, variant,
    utm_source, utm_medium, utm_campaign, utm_content, session_id,
  } = result.data

  const supabase = getServiceDb()
  const { error } = await supabase.from("landing_events").insert({
    event_type,
    slug,
    location_key: location_key ?? null,
    variant: variant ?? null,
    utm_source: utm_source ?? null,
    utm_medium: utm_medium ?? null,
    utm_campaign: utm_campaign ?? null,
    utm_content: utm_content ?? null,
    session_id: session_id ?? null,
  })

  if (error) return NextResponse.json({ error: "No se pudo registrar el evento" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
