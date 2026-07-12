import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, listPosts, createGoogleBusinessPost } from "@/lib/google-business"
import { parseJsonBody } from "@/lib/api-validation"

async function requireAuth() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return null
  return user
}

export async function GET() {
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
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
    console.error(`[google-business/posts] GET: ${String(e)}`)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { summary } = parsedBody.data as { summary?: string }
  if (typeof summary !== "string" || !summary.trim() || summary.length > 1500) {
    return NextResponse.json({ error: "summary required (máx. 1500 caracteres)" }, { status: 400 })
  }

  const supabase = getServiceDb()
  try {
    const data = await createGoogleBusinessPost(supabase, { summary })
    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const isKnownCondition = message.includes("Account ID") || message === "Token expired"
    if (!isKnownCondition) console.error(`[google-business/posts] POST: ${message}`)
    return NextResponse.json({ error: message }, { status: isKnownCondition ? (message === "Token expired" ? 401 : 400) : 500 })
  }
}
