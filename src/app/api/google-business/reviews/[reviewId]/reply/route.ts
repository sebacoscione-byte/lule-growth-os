import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, replyToReview } from "@/lib/google-business"
import { parseJsonBody } from "@/lib/api-validation"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { reviewId } = await params
  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const { comment } = parsedBody.data as { comment?: string }
  if (typeof comment !== "string" || !comment.trim() || comment.length > 4000) {
    return NextResponse.json({ error: "comment required (máx. 4000 caracteres)" }, { status: 400 })
  }

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Falta Account ID. Google no lo expone en algunas cuentas; responde resenas desde el panel oficial." }, { status: 400 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await replyToReview(token, info.google_account_id, info.google_location_id, reviewId, comment)
    return NextResponse.json(data)
  } catch (e) {
    console.error(`[google-business/reviews/reply] review=${reviewId}: ${String(e)}`)
    return NextResponse.json({ error: "No se pudo publicar la respuesta en Google Business" }, { status: 500 })
  }
}
