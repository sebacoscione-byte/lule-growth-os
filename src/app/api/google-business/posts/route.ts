import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, listPosts, createPost } from "@/lib/google-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await listPosts(token, info.google_account_id, info.google_location_id)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { summary } = await req.json() as { summary: string }
  if (!summary?.trim()) return NextResponse.json({ error: "summary required" }, { status: 400 })

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await createPost(token, info.google_account_id, info.google_location_id, summary)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
