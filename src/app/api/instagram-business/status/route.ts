import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getConnectionInfo, getValidToken } from "@/lib/instagram-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info) return NextResponse.json({ connected: false })

  const token = await getValidToken(supabase).catch(() => null)
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    username: info.instagram_username ?? null,
  })
}
