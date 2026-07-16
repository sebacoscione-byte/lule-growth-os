import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, listPosts, createGoogleBusinessPost } from "@/lib/google-business"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

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
    return NextResponse.json({ error: "No se pudieron consultar las publicaciones de Google Business" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

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
    if (message === "Token expired") {
      return NextResponse.json({ error: "La conexión con Google Business expiró" }, { status: 401 })
    }
    if (message.includes("Account ID")) {
      return NextResponse.json({ error: "La cuenta de Google Business no tiene una ubicación seleccionada" }, { status: 400 })
    }
    return NextResponse.json({ error: "No se pudo crear la publicación en Google Business" }, { status: 500 })
  }
}
