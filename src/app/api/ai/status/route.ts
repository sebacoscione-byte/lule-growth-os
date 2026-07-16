import { NextResponse } from "next/server"
import { getAiConfiguration } from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"

const AI_STATUS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const supabase = await createClient()
  const auth = await authorizeStaff(supabase, { allowedRoles: AI_STATUS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  return NextResponse.json(getAiConfiguration())
}
