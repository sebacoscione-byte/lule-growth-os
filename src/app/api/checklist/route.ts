import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("google_local_checklist")
    .select("*")
    .order("item_key")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { item_key, completed, notes } = await request.json()

  const { data, error } = await supabase
    .from("google_local_checklist")
    .upsert({ item_key, completed, notes }, { onConflict: "item_key" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
