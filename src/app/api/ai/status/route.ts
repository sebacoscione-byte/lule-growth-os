import { NextResponse } from "next/server"
import { getAiConfiguration } from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return NextResponse.json(getAiConfiguration())
}
