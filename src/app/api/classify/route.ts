import { NextResponse } from "next/server"
import { classifyMessage, getPublicAiError } from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { parseJsonBody, formatZodError } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const classifySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  lead_id: z.string().trim().min(1).optional().nullable(),
})
const PATIENT_DATA_ROLES = ["owner", "doctor", "reception"] as const

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: PATIENT_DATA_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const parsedBody = await parseJsonBody(request)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const result_ = classifySchema.safeParse(parsedBody.data)
  if (!result_.success) {
    return NextResponse.json({ error: formatZodError(result_.error) }, { status: 400 })
  }
  const { message, lead_id } = result_.data

  try {
    const result = await classifyMessage(message)

    if (lead_id) {
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
    return NextResponse.json({ error: getPublicAiError(e) }, { status: 500 })
  }
}
