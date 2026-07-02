import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { clearTokens } from "@/lib/instagram-business"

export async function POST() {
  const supabase = await createServiceClient()
  await clearTokens(supabase)
  return NextResponse.json({ ok: true })
}
