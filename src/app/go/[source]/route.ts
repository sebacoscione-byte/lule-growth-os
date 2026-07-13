import { NextRequest, NextResponse } from "next/server"
import { isTrackedChannel, trackedLandingDestination } from "@/lib/tracked-links"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const { source } = await params
  if (!isTrackedChannel(source)) {
    return NextResponse.redirect(new URL("/dra-lucia-chahin", request.url))
  }

  return NextResponse.redirect(new URL(trackedLandingDestination(source), request.url), 307)
}
