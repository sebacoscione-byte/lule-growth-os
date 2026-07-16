import { createHash } from "node:crypto"
import { z } from "zod"
import type { WhatsAppInboundMessageType } from "@/lib/whatsapp-bot"

const MAX_ENTRIES = 25
const MAX_CHANGES_PER_ENTRY = 50
const MAX_EVENTS_PER_CHANGE = 100
const MAX_TOTAL_EVENTS = 200
const MAX_TEXT_LENGTH = 4096

const boundedString = (max: number) => z.string().min(1).max(max)
const phoneSchema = z.string().regex(/^\d{6,20}$/)

const contactSchema = z.object({
  wa_id: phoneSchema,
  profile: z.object({ name: z.string().max(200).optional() }).passthrough().optional(),
}).passthrough()

const referralSchema = z.object({
  source_type: z.string().max(80).optional(),
  ctwa_clid: z.string().max(500).optional(),
}).passthrough()

const messageSchema = z.object({
  id: boundedString(512),
  from: phoneSchema,
  timestamp: z.string().regex(/^\d{1,16}$/).optional(),
  type: boundedString(40),
  text: z.object({ body: z.string().max(MAX_TEXT_LENGTH) }).passthrough().optional(),
  interactive: z.object({
    type: z.string().max(40),
    button_reply: z.object({ id: boundedString(256), title: z.string().max(256) }).passthrough().optional(),
    list_reply: z.object({ id: boundedString(256), title: z.string().max(256) }).passthrough().optional(),
  }).passthrough().optional(),
  button: z.object({ payload: boundedString(256), text: z.string().max(256) }).passthrough().optional(),
  referral: referralSchema.optional(),
}).passthrough()

const statusSchema = z.object({
  id: boundedString(512),
  status: z.enum(["sent", "delivered", "read", "failed", "deleted", "warning"]),
  timestamp: z.string().regex(/^\d{1,16}$/),
  recipient_id: phoneSchema.optional(),
  errors: z.array(z.object({ code: z.union([z.string(), z.number()]) }).passthrough()).max(10).optional(),
}).passthrough()

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: phoneSchema }).passthrough(),
  contacts: z.array(contactSchema).max(MAX_EVENTS_PER_CHANGE).optional(),
  messages: z.array(z.unknown()).max(MAX_EVENTS_PER_CHANGE).optional(),
  statuses: z.array(z.unknown()).max(MAX_EVENTS_PER_CHANGE).optional(),
}).passthrough()

const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    changes: z.array(z.object({ value: valueSchema.optional() }).passthrough()).max(MAX_CHANGES_PER_ENTRY),
  }).passthrough()).max(MAX_ENTRIES),
}).passthrough()

export type WhatsAppQueueEventType = "inbound" | "status"

export interface NormalizedWhatsAppEvent {
  event_key: string
  event_type: WhatsAppQueueEventType
  related_wa_message_id: string
  phone: string | null
  phone_hash: string
  message_type: WhatsAppInboundMessageType | null
  message_text: string | null
  wa_name: string | null
  button_id: string | null
  referral: Record<string, string> | null
  delivery_status: "sent" | "delivered" | "read" | "failed" | "deleted" | "warning" | null
  status_error_code: string | null
  occurred_at: string | null
  batch_order: number
  phone_number_id: string
}

export interface NormalizedWhatsAppWebhook {
  events: NormalizedWhatsAppEvent[]
  invalidEventCount: number
}

export class InvalidWhatsAppWebhookError extends Error {
  constructor(public readonly reason: "schema" | "too_many_events") {
    super(`invalid_whatsapp_webhook:${reason}`)
    this.name = "InvalidWhatsAppWebhookError"
  }
}

/** Operational partition key only. It is not an anonymization guarantee. */
export function hashWhatsAppPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex")
}

function timestampToIso(timestamp?: string): string | null {
  if (!timestamp) return null
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeMessageType(message: z.infer<typeof messageSchema>): {
  type: WhatsAppInboundMessageType
  text: string
  buttonId: string | null
} {
  if (message.type === "text") {
    return { type: "text", text: message.text?.body ?? "", buttonId: null }
  }
  if (message.type === "interactive" && message.interactive?.type === "button_reply") {
    return {
      type: "button_reply",
      text: message.interactive.button_reply?.title ?? "",
      buttonId: message.interactive.button_reply?.id ?? null,
    }
  }
  if (message.type === "interactive" && message.interactive?.type === "list_reply") {
    return {
      type: "list_reply",
      text: message.interactive.list_reply?.title ?? "",
      buttonId: message.interactive.list_reply?.id ?? null,
    }
  }
  if (message.type === "button") {
    return { type: "button_reply", text: message.button?.text ?? "", buttonId: message.button?.payload ?? null }
  }

  const supportedAttachmentTypes: WhatsAppInboundMessageType[] = [
    "audio", "image", "document", "sticker", "video", "location", "contacts",
  ]
  const type = supportedAttachmentTypes.includes(message.type as WhatsAppInboundMessageType)
    ? message.type as WhatsAppInboundMessageType
    : "unknown"
  return { type, text: "", buttonId: null }
}

function sanitizeReferral(referral?: z.infer<typeof referralSchema>): Record<string, string> | null {
  if (!referral) return null
  // El valor único `ctwa_clid` no es necesario: alcanza con conservar la categoría "ad" para
  // calcular la ventana de entrada. URLs, creative IDs y click IDs quedan fuera de la cola.
  const sourceType = referral.source_type || (referral.ctwa_clid ? "ad" : null)
  return sourceType ? { source_type: sourceType } : null
}

function invalidTechnicalEvent(
  rawEvent: unknown,
  kind: "message" | "status",
  phoneNumberId: string,
  batchOrder: number
): NormalizedWhatsAppEvent {
  const digest = createHash("sha256").update(JSON.stringify(rawEvent)).digest("hex")
  const eventKey = `invalid.${kind}.${digest}`
  return {
    event_key: eventKey,
    event_type: "inbound",
    related_wa_message_id: eventKey,
    phone: null,
    phone_hash: hashWhatsAppPhone(eventKey),
    message_type: null,
    message_text: null,
    wa_name: null,
    button_id: null,
    referral: null,
    delivery_status: null,
    status_error_code: "invalid_normalized_event",
    occurred_at: null,
    batch_order: batchOrder,
    phone_number_id: phoneNumberId,
  }
}

/**
 * Converts Meta's payload to the smallest envelope the worker needs. Media ids, captions and raw
 * payloads are deliberately not retained or downloaded.
 */
export function normalizeWhatsAppWebhook(input: unknown): NormalizedWhatsAppWebhook {
  const parsed = webhookSchema.safeParse(input)
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some(issue => issue.code === "too_big")
    throw new InvalidWhatsAppWebhookError(tooMany ? "too_many_events" : "schema")
  }

  const events: NormalizedWhatsAppEvent[] = []
  let invalidEventCount = 0
  let seenEventCount = 0

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = change.value
      if (!value) continue
      const phoneNumberId = value.metadata.phone_number_id

      for (const rawMessage of value.messages ?? []) {
        seenEventCount += 1
        if (seenEventCount > MAX_TOTAL_EVENTS) throw new InvalidWhatsAppWebhookError("too_many_events")
        const result = messageSchema.safeParse(rawMessage)
        if (!result.success) {
          invalidEventCount += 1
          events.push(invalidTechnicalEvent(rawMessage, "message", phoneNumberId, events.length))
          continue
        }
        const message = result.data
        const normalized = normalizeMessageType(message)
        const contact = value.contacts?.find(item => item.wa_id === message.from)
        events.push({
          event_key: message.id,
          event_type: "inbound",
          related_wa_message_id: message.id,
          phone: message.from,
          phone_hash: hashWhatsAppPhone(message.from),
          message_type: normalized.type,
          message_text: normalized.text,
          wa_name: contact?.profile?.name?.trim() || null,
          button_id: normalized.buttonId,
          referral: sanitizeReferral(message.referral),
          delivery_status: null,
          status_error_code: null,
          occurred_at: timestampToIso(message.timestamp),
          batch_order: events.length,
          phone_number_id: phoneNumberId,
        })
      }

      for (const rawStatus of value.statuses ?? []) {
        seenEventCount += 1
        if (seenEventCount > MAX_TOTAL_EVENTS) throw new InvalidWhatsAppWebhookError("too_many_events")
        const result = statusSchema.safeParse(rawStatus)
        if (!result.success) {
          invalidEventCount += 1
          events.push(invalidTechnicalEvent(rawStatus, "status", phoneNumberId, events.length))
          continue
        }
        const status = result.data
        const phone = status.recipient_id ?? null
        const statusIdentity = `${status.id}|${status.status}|${status.timestamp}|${phone ?? "unknown"}`
        events.push({
          event_key: `status.${createHash("sha256").update(statusIdentity).digest("hex")}`,
          event_type: "status",
          related_wa_message_id: status.id,
          phone,
          phone_hash: hashWhatsAppPhone(phone ?? `status:${status.id}`),
          message_type: null,
          message_text: null,
          wa_name: null,
          button_id: null,
          referral: null,
          delivery_status: status.status,
          status_error_code: status.errors?.[0]?.code !== undefined
            ? String(status.errors[0].code).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) || null
            : null,
          occurred_at: timestampToIso(status.timestamp),
          batch_order: events.length,
          phone_number_id: phoneNumberId,
        })
      }
    }
  }

  return { events, invalidEventCount }
}
