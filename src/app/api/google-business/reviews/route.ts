import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, listReviews } from "@/lib/google-business"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function GET() {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Falta Account ID. Google no lo expone en algunas cuentas; responde resenas desde el panel oficial hasta que la API permita descubrirlo." }, { status: 400 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await listReviews(token, info.google_account_id, info.google_location_id)
    return NextResponse.json(data)
  } catch (e) {
    console.error(`[google-business/reviews] ${String(e)}`)
    return NextResponse.json({ error: "No se pudieron consultar las reseñas de Google Business" }, { status: 500 })
  }
}
