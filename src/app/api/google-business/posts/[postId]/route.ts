import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getValidToken, getConnectionInfo, deletePost } from "@/lib/google-business"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
