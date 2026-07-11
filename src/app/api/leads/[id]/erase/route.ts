import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { eraseLead } from "@/lib/data-erasure"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  try {
    await eraseLead(id, user.email ?? user.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
