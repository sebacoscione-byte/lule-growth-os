import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { Lead } from "@/types"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const channel = searchParams.get("channel")
  const service = searchParams.get("service")
  const q = searchParams.get("q")

  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })

  if (status) query = query.eq("status", status)
  if (channel) query = query.eq("origin_channel", channel)
  if (service) query = query.eq("requested_service", service)
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,instagram_username.ilike.%${q}%`)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from("leads")
    .insert([body])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
