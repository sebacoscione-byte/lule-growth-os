import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import {
  getValidToken, getConnectionInfo, getLocation,
  updateDescription, updateWebsite, updatePhone, updateHours,
  type HourPeriod
} from "@/lib/google-business"

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
  const body = await req.json() as {
    description?: string
    websiteUri?: string
    primaryPhone?: string
    hours?: HourPeriod[]
  }

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_location_name) return NextResponse.json({ error: "Not connected" }, { status: 401 })

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    if (body.description !== undefined) {
      await updateDescription(token, info.google_location_name, body.description)
    }
    if (body.websiteUri !== undefined) {
      await updateWebsite(token, info.google_location_name, body.websiteUri)
    }
    if (body.primaryPhone !== undefined) {
      await updatePhone(token, info.google_location_name, body.primaryPhone)
    }
    if (body.hours !== undefined) {
      await updateHours(token, info.google_location_name, body.hours)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
