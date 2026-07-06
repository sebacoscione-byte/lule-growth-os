import { createServiceClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const { allowed } = checkRateLimit(`lead:${ip}`, 5, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá en unos minutos." }, { status: 429 })
  }

  const body = await request.json()

  const {
    name,
    phone,
    requested_service,
    preferred_location,
    insurance,
    general_reason,
    consent_to_contact,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    origin_url,
    landing_page,
    clicked_cimel_cta,
    clicked_swiss_cta,
    clicked_britanico_cta,
  } = body

  if (!consent_to_contact || !phone?.trim()) {
    return NextResponse.json(
      { error: "Se requiere teléfono y consentimiento para continuar" },
      { status: 400 }
    )
  }

  const supabase = await createServiceClient()

  const originChannel =
    utm_source === "google_maps" ? "google_maps" :
    utm_source === "instagram" ? "instagram" :
    utm_source === "google_search" ? "google_search" :
    utm_source === "whatsapp" ? "whatsapp" : "landing_page"

  const preferredDay =
    preferred_location === "cimel_lanus" ? "martes" :
    preferred_location === "swiss_lomas" ? "viernes" :
    preferred_location === "hospital_britanico" ? "miercoles" : "sin_definir"

  const followupDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("leads")
    .insert([{
      name: name?.trim() || null,
      phone: phone.trim(),
      instagram_username: null,
      origin_channel: originChannel,
      origin_campaign: utm_campaign || null,
      searched_keyword: null,
      requested_service: requested_service || "no_definido",
      preferred_location: preferred_location || "sin_definir",
      preferred_day: preferredDay,
      insurance: (typeof insurance === "string" && insurance.trim()) || null,
      general_reason: general_reason?.trim() || null,
      consent_to_contact: true,
      status: "seguimiento_pendiente",
      priority_score: 5,
      possible_emergency: false,
      requires_human: false,
      confirmed_booked: false,
      followup_due_at: followupDueAt,
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      utm_content: utm_content || null,
      origin_url: origin_url || null,
      landing_page: landing_page || null,
      clicked_cimel_cta: clicked_cimel_cta ?? false,
      clicked_swiss_cta: clicked_swiss_cta ?? false,
      clicked_britanico_cta: clicked_britanico_cta ?? false,
      booking_instruction_viewed: (clicked_cimel_cta || clicked_swiss_cta || clicked_britanico_cta) ?? false,
    }])
    .select("id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id }, { status: 201 })
}
