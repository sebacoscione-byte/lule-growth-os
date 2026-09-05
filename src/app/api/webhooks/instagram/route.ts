import { NextResponse } from "next/server"
import { getServiceDb } from "@/lib/supabase/service"
import { persistInstagramInboxItems } from "@/lib/instagram-inbox"
import { isValidInstagramSignature } from "@/lib/instagram-webhook-signature"
import {
  InvalidInstagramWebhookError,
  normalizeInstagramWebhook,
} from "@/lib/instagram-webhook-normalizer"

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  if (
    mode === "subscribe" &&
    challenge &&
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN &&
    token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

function bodySize(body: string): number {
  return new TextEncoder().encode(body).byteLength
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase().split(";", 1)[0].trim()
  if (contentType !== "application/json") {
    return NextResponse.json({ status: "unsupported_media_type" }, { status: 415 })
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ status: "payload_too_large" }, { status: 413 })
  }

  const rawBody = await request.text()
  if (bodySize(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ status: "payload_too_large" }, { status: 413 })
  }
  if (!isValidInstagramSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    process.env.INSTAGRAM_APP_SECRET
  )) {
    return NextResponse.json({ status: "invalid_signature" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ status: "invalid_json" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || (body as { object?: unknown }).object !== "instagram") {
    return NextResponse.json({ status: "ignored" })
  }

  let normalized
  try {
    normalized = normalizeInstagramWebhook(body)
  } catch (error) {
    const tooMany = error instanceof InvalidInstagramWebhookError && error.reason === "too_many_events"
    return NextResponse.json(
      { status: tooMany ? "too_many_events" : "invalid_schema" },
      { status: tooMany ? 413 : 400 }
    )
  }

  try {
    await persistInstagramInboxItems(getServiceDb(), normalized.items)
  } catch {
    // Meta sólo recibe 200 después de una escritura durable; de otro modo puede reintentar.
    return NextResponse.json({ status: "storage_unavailable" }, { status: 503 })
  }
  return NextResponse.json({
    status: "accepted",
    stored: normalized.items.length,
    invalid_events: normalized.invalidEventCount,
  })
}
