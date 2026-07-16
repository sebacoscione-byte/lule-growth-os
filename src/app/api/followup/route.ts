import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateFollowupMessage } from "@/lib/ai"
import { LOCATION_LABELS } from "@/types"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"

const followupSchema = z.object({ lead_id: z.string().trim().min(1) })

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .lte("followup_due_at", now)
    .in("status", ["derivado_cimel", "derivado_swiss", "derivado_britanico", "seguimiento_pendiente"])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result = followupSchema.safeParse(parsedBody.data)
  if (!result.success) {
    return NextResponse.json({ error: formatZodError(result.error) }, { status: 400 })
  }
  const { lead_id } = result.data

  const { data: lead } = await supabase.from("leads").select("*").eq("id", lead_id).single()
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 })
  if (lead.origin_channel === "whatsapp") {
    return NextResponse.json({
      error: "Los seguimientos de WhatsApp sólo se envían por el worker durable con consentimiento específico.",
    }, { status: 409 })
  }

  const locationLabel = LOCATION_LABELS[lead.preferred_location] ?? "la institución correspondiente"
  const message = await generateFollowupMessage(lead.name, locationLabel)

  await supabase.from("messages").insert({
    lead_id,
    role: "assistant",
    content: message,
  })

  await supabase.from("leads").update({
    status: "seguimiento_pendiente",
    followup_due_at: null,
  }).eq("id", lead_id)

  return NextResponse.json({ message })
}
