import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFollowupSuggestion, getPublicAiError } from "@/lib/ai"
import { toChronologicalContext } from "@/lib/conversation-context"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { lead_id } = await request.json()
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const [{ data: lead }, { data: recentHistory }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", lead_id).single(),
    // Últimos 20 mensajes (más nuevo primero) — no los primeros 20 de la conversación (CRM-01).
    supabase.from("messages").select("role,content").eq("lead_id", lead_id)
      .order("created_at", { ascending: false }).limit(20),
  ])

  const location =
    lead?.preferred_location === "cimel_lanus" ? "CIMEL Lanús (martes)" :
    lead?.preferred_location === "swiss_lomas" ? "Swiss Medical Lomas (viernes)" :
    lead?.preferred_location === "hospital_britanico" ? "Hospital Británico (miércoles)" :
    "CIMEL Lanús, Hospital Británico o Swiss Medical Lomas"

  const leadContext = `Lead: ${lead?.name ?? "anónimo"}. Teléfono: ${lead?.phone ?? "no registrado"}. Canal: ${lead?.origin_channel}. Servicio buscado: ${lead?.requested_service}. Sede preferida: ${location}. Estado actual: ${lead?.status}.`
  const conversationHistory = toChronologicalContext((recentHistory ?? []) as { role: "user" | "assistant"; content: string }[])

  try {
    const suggestion = await generateFollowupSuggestion(leadContext, conversationHistory)
    return NextResponse.json({ suggestion })
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error) }, { status: 500 })
  }
}
