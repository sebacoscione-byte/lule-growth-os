import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { cost_amount } = await request.json() as { cost_amount: number | null }
  if (cost_amount !== null && (typeof cost_amount !== "number" || cost_amount < 0)) {
    return NextResponse.json({ error: "cost_amount inválido" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("whatsapp_pricing_rules")
    .update({ cost_amount })
    .eq("id", id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
