import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFollowupSuggestion, getPublicAiError } from "@/lib/ai"
import { toChronologicalContext } from "@/lib/conversation-context"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const PATIENT_DATA_ROLES = ["owner", "doctor", "reception"] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PATIENT_DATA_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { lead_id } = parsedBody.data as { lead_id?: string }
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const { data: lead } = await supabase
    .from("leads")
    .select("name, origin_channel, requested_service, preferred_location, status")
    .eq("id", lead_id)
    .single()

  if (!lead) return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 })
  if (lead.origin_channel === "whatsapp") {
    return NextResponse.json(
      { error: "Las sugerencias generativas están deshabilitadas para conversaciones de WhatsApp." },
      { status: 409 }
    )
  }

  // Últimos 20 mensajes (más nuevo primero) — no los primeros 20 de la conversación (CRM-01).
  const { data: recentHistory } = await supabase
    .from("messages")
    .select("role,content")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: false })
    .limit(20)

  const location =
    lead?.preferred_location === "cimel_lanus" ? "CIMEL Lanús (martes)" :
    lead?.preferred_location === "swiss_lomas" ? "Swiss Medical Lomas (viernes)" :
    lead?.preferred_location === "hospital_britanico" ? "Hospital Británico (miércoles)" :
    "CIMEL Lanús, Hospital Británico o Swiss Medical Lomas"

  const leadContext = `Lead: ${lead.name ?? "anónimo"}. Canal: ${lead.origin_channel}. Servicio buscado: ${lead.requested_service}. Sede preferida: ${location}. Estado actual: ${lead.status}.`
  const conversationHistory = toChronologicalContext((recentHistory ?? []) as { role: "user" | "assistant"; content: string }[])

  try {
    const suggestion = await generateFollowupSuggestion(leadContext, conversationHistory)
    return NextResponse.json({ suggestion })
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
