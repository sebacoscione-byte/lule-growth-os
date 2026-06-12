import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { getValidToken, getConnectionInfo, replyToReview } from "@/lib/google-business"

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params
  const { comment } = await req.json() as { comment: string }
  if (!comment?.trim()) return NextResponse.json({ error: "comment required" }, { status: 400 })

  const supabase = await createServiceClient()
  const info = await getConnectionInfo(supabase)
  if (!info?.google_account_id || !info?.google_location_id) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 })
  }

  const token = await getValidToken(supabase)
  if (!token) return NextResponse.json({ error: "Token expired" }, { status: 401 })

  try {
    const data = await replyToReview(token, info.google_account_id, info.google_location_id, reviewId, comment)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
