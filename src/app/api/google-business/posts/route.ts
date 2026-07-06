import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, listPosts, createGoogleBusinessPost } from "@/lib/google-business"

async function requireAuth() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return null
  return user
}

export async function GET() {
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Falta Account ID. Google no lo expone en algunas cuentas; usa el panel oficial hasta que la API permita descubrirlo." }, { status: 400 })
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
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { summary } = await req.json() as { summary: string }
  if (!summary?.trim()) return NextResponse.json({ error: "summary required" }, { status: 400 })

  const supabase = await createServiceClient()
  try {
    const data = await createGoogleBusinessPost(supabase, { summary })
    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: message.includes("Account ID") ? 400 : message === "Token expired" ? 401 : 500 })
  }
}
