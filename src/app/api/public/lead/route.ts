import { getServiceDb } from "@/lib/supabase/service"
import { NextResponse } from "next/server"
import { z } from "zod"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

// Límites generosos pero acotados: cortan payloads abusivos (o basura) sin rechazar datos reales
// de un paciente. Los enums coinciden exactamente con RequestedService/PreferredLocation
// (src/types/index.ts) — un valor fuera de esos dos rompe los labels/lookups que asumen el tipo.
const leadSchema = z.object({
  name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(6).max(40),
  requested_service: z.enum(["consulta_cardiologia", "ecocardiograma", "no_definido"]).optional(),
  preferred_location: z.enum(["cimel_lanus", "swiss_lomas", "hospital_britanico", "sin_definir"]).optional(),
  insurance: z.string().trim().max(200).optional().nullable(),
  general_reason: z.string().trim().max(2000).optional().nullable(),
  consent_to_contact: z.literal(true),
  utm_source: z.string().trim().max(200).optional().nullable(),
  utm_medium: z.string().trim().max(200).optional().nullable(),
  utm_campaign: z.string().trim().max(200).optional().nullable(),
  utm_content: z.string().trim().max(200).optional().nullable(),
  origin_url: z.string().trim().max(2000).optional().nullable(),
  landing_page: z.string().trim().max(200).optional().nullable(),
  clicked_cimel_cta: z.boolean().optional(),
  clicked_swiss_cta: z.boolean().optional(),
  clicked_britanico_cta: z.boolean().optional(),
})

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const { allowed } = await checkRateLimit(`lead:${ip}`, 5, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá en unos minutos." }, { status: 429 })
  }

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = leadSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const {
    name, phone, requested_service, preferred_location, insurance, general_reason,
    utm_source, utm_medium, utm_campaign, utm_content, origin_url, landing_page,
    clicked_cimel_cta, clicked_swiss_cta, clicked_britanico_cta,
  } = result.data

  const supabase = getServiceDb()

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
      name: name || null,
      phone,
      instagram_username: null,
      origin_channel: originChannel,
      origin_campaign: utm_campaign || null,
      searched_keyword: null,
      requested_service: requested_service || "no_definido",
      preferred_location: preferred_location || "sin_definir",
      preferred_day: preferredDay,
      insurance: insurance || null,
      general_reason: general_reason || null,
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

  if (error) return NextResponse.json({ error: "No se pudo guardar el contacto" }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id }, { status: 201 })
}
