import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { getConnectionInfo, getValidToken } from "@/lib/instagram-business"

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ connected: false })

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    username: info.instagram_username ?? null,
  })
}
