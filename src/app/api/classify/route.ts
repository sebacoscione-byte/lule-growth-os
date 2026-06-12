import { NextResponse } from "next/server"
import { classifyMessage } from "@/lib/claude"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const { message, lead_id } = await request.json()

  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 })
  }

  try {
    const result = await classifyMessage(message)

    if (lead_id) {
      const supabase = await createClient()
      await supabase.from("leads").update({
        requested_service: result.requested_service,
        preferred_location: result.suggested_location === "preguntar" ? "sin_definir" : result.suggested_location,
        preferred_day: result.suggested_day === "preguntar" ? "sin_definir" : result.suggested_day,
        priority_score: result.priority_score,
        requires_human: result.requires_human,
        possible_emergency: result.possible_emergency,
        ai_summary: `Intent: ${result.intent}. Next: ${result.next_action}`,
        last_message: message,
      }).eq("id", lead_id)
    }

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
