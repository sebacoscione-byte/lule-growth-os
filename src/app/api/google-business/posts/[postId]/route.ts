import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, deletePost } from "@/lib/google-business"
import { authorizeStaff } from "@/lib/staff-authz"

const GOOGLE_BUSINESS_ROLES = ["owner", "doctor"] as const

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const userClient = await createClient()
  const auth = await authorizeStaff(userClient, { allowedRoles: GOOGLE_BUSINESS_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { postId } = await params
  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Falta Account ID. Google no lo expone en algunas cuentas; administra publicaciones desde el panel oficial." }, { status: 400 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    await deletePost(token, info.google_account_id, info.google_location_id, postId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`[google-business/posts] DELETE post=${postId}: ${String(e)}`)
    return NextResponse.json({ error: "No se pudo eliminar la publicación de Google Business" }, { status: 500 })
  }
}
