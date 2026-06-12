import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateReply, getPublicAiError } from "@/lib/ai"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lead_id = searchParams.get("lead_id")
  if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 })

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const { lead_id, content, generate_reply } = await request.json()
  const supabase = await createClient()

  const { data: userMessage } = await supabase
    .from("messages")
    .insert({ lead_id, role: "user", content })
    .select()
    .single()

  await supabase.from("leads").update({ last_message: content }).eq("id", lead_id)

  if (!generate_reply) {
    return NextResponse.json({ user_message: userMessage })
  }

  const { data: lead } = await supabase.from("leads").select("*").eq("id", lead_id).single()
  const { data: history } = await supabase
    .from("messages")
    .select("role,content")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: true })
    .limit(20)

  const leadContext = `Lead: ${lead?.name ?? "anónimo"}. Canal: ${lead?.origin_channel}. Servicio: ${lead?.requested_service}. Ubicación preferida: ${lead?.preferred_location}.`
  const conversationHistory = (history ?? []).slice(0, -1) as { role: "user" | "assistant"; content: string }[]

  let replyText: string
  try {
    replyText = await generateReply(content, leadContext, conversationHistory)
  } catch (error) {
    return NextResponse.json({ error: getPublicAiError(error), user_message: userMessage }, { status: 500 })
  }

  const { data: assistantMessage } = await supabase
    .from("messages")
    .insert({ lead_id, role: "assistant", content: replyText })
    .select()
    .single()

  return NextResponse.json({ user_message: userMessage, assistant_message: assistantMessage })
}
