import { after, NextRequest, NextResponse } from "next/server"
import { isValidWhatsAppSignature } from "@/lib/whatsapp-webhook-signature"
import { drainWhatsAppInboundQueue, enqueueWhatsAppEvents } from "@/lib/whatsapp-inbound-queue"
import { InvalidWhatsAppWebhookError, normalizeWhatsAppWebhook } from "@/lib/whatsapp-webhook-normalizer"

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024
export const maxDuration = 60

// Meta llama a GET para verificar el webhook al configurarlo.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

function isJsonContentType(value: string | null): boolean {
  return value?.toLowerCase().split(";", 1)[0].trim() === "application/json"
}

function exceedsDeclaredBodyLimit(req: Request): boolean {
  const rawLength = req.headers.get("content-length")
  if (!rawLength) return false
  const length = Number(rawLength)
  return !Number.isSafeInteger(length) || length < 0 || length > MAX_WEBHOOK_BODY_BYTES
}

function bodyByteLength(body: string): number {
  return new TextEncoder().encode(body).byteLength
}

/**
 * The request path only verifies, normalizes and durably persists. Patient processing starts in
 * `after()` once the 200 response has been produced; the SQL queue remains the source of truth if
 * that accelerator is interrupted.
 */
export async function POST(req: NextRequest) {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return NextResponse.json({ status: "unsupported_media_type" }, { status: 415 })
  }
  if (exceedsDeclaredBodyLimit(req)) {
    return NextResponse.json({ status: "payload_too_large" }, { status: 413 })
  }

  const rawBody = await req.text()
  if (bodyByteLength(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ status: "payload_too_large" }, { status: 413 })
  }

  const signature = req.headers.get("x-hub-signature-256")
  if (!isValidWhatsAppSignature(rawBody, signature, process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ status: "invalid_signature" }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ status: "invalid_json" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || (body as { object?: unknown }).object !== "whatsapp_business_account") {
    return NextResponse.json({ status: "ignored" })
  }

  let normalized
  try {
    normalized = normalizeWhatsAppWebhook(body)
  } catch (error) {
    const status = error instanceof InvalidWhatsAppWebhookError && error.reason === "too_many_events" ? 413 : 400
    return NextResponse.json({ status: status === 413 ? "too_many_events" : "invalid_schema" }, { status })
  }

  const expectedPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!expectedPhoneNumberId) {
    return NextResponse.json({ status: "webhook_not_configured" }, { status: 503 })
  }
  const acceptedEvents = normalized.events.filter(
    event => event.phone_number_id === expectedPhoneNumberId
  )

  try {
    await enqueueWhatsAppEvents(acceptedEvents)
  } catch {
    // Nothing was acknowledged durably, so Meta should retry the signed delivery.
    return NextResponse.json({ status: "queue_unavailable" }, { status: 503 })
  }

  if (acceptedEvents.length > 0) {
    after(async () => {
      try {
        await drainWhatsAppInboundQueue({ maxEvents: 100, timeBudgetMs: 45_000 })
      } catch {
        // No event data is logged. The durable queue and the internal worker keep the retry path.
        console.error("[whatsapp-worker] drain_failed")
      }
    })
  }

  return NextResponse.json({
    status: "accepted",
    queued: acceptedEvents.length,
    invalid_events: normalized.invalidEventCount,
    ignored_numbers: normalized.events.length - acceptedEvents.length,
  })
}
