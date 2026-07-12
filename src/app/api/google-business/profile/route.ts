import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import {
  getValidToken, getConnectionInfo, getLocation,
  updateDescription, updateWebsite, updatePhone, updateHours,
  type HourPeriod
} from "@/lib/google-business"
import { parseJsonBody } from "@/lib/api-validation"

async function requireAuth() {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  return user
}

export async function GET() {
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = getServiceDb()
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
  if (!await requireAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsedBody = await parseJsonBody(req)
  if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: 400 })

  const body = parsedBody.data as {
    description?: string
    websiteUri?: string
    primaryPhone?: string
    hours?: HourPeriod[]
  }
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 1500)) {
    return NextResponse.json({ error: "description inválida (máx. 1500 caracteres)" }, { status: 400 })
  }
  if (body.websiteUri !== undefined && (typeof body.websiteUri !== "string" || body.websiteUri.length > 2000)) {
    return NextResponse.json({ error: "websiteUri inválido" }, { status: 400 })
  }
  if (body.primaryPhone !== undefined && (typeof body.primaryPhone !== "string" || body.primaryPhone.length > 40)) {
    return NextResponse.json({ error: "primaryPhone inválido" }, { status: 400 })
  }
  if (body.hours !== undefined && !Array.isArray(body.hours)) {
    return NextResponse.json({ error: "hours inválido" }, { status: 400 })
  }

  const supabase = getServiceDb()
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
