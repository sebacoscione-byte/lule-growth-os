import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

async function getAuthedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return supabase
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getAuthedClient()
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getAuthedClient()
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  // Auto-set followup_due_at when transitioning to seguimiento_pendiente
  if (body.status === "seguimiento_pendiente" && !body.followup_due_at) {
    body.followup_due_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }

  const { data, error } = await supabase
    .from("leads")
    .update(body)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getAuthedClient()
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from("leads").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
