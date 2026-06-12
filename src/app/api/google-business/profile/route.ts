import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, getLocation, updateDescription } from "@/lib/google-business"

export async function GET() {
  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_location_name) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await getLocation(token, info.google_location_name)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { description } = await req.json() as { description: string }

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_location_name) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await updateDescription(token, info.google_location_name, description)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
