import { NextResponse } from "next/server"
import { checkWhatsAppCloudApiConfiguration } from "@/lib/whatsapp"

export const maxDuration = 15

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`
}

/** Read-only Meta preflight. The response is a closed status and never includes credentials or IDs. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await checkWhatsAppCloudApiConfiguration()
  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
}
