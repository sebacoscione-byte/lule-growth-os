import { createHash } from "node:crypto"
import { z } from "zod"

const MAX_ENTRIES = 25
const MAX_EVENTS = 200
const MAX_TEXT_LENGTH = 4096
const idSchema = z.string().min(1).max(512)

const partySchema = z.object({ id: idSchema }).passthrough()
const messageSchema = z.object({
  mid: idSchema,
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  is_echo: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
  attachments: z.array(z.object({ type: z.string().max(80).optional() }).passthrough()).max(10).optional(),
}).passthrough()
const messagingSchema = z.object({
  sender: partySchema,
  recipient: partySchema,
  timestamp: z.union([z.number(), z.string()]),
  message: messageSchema.optional(),
}).passthrough()
const commentValueSchema = z.object({
  id: idSchema,
  from: z.object({ id: idSchema.optional(), username: z.string().max(100).optional() }).passthrough().optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  media: z.object({ id: idSchema.optional() }).passthrough().optional(),
  created_time: z.union([z.string(), z.number()]).optional(),
}).passthrough()
const entrySchema = z.object({
  id: idSchema,
  time: z.union([z.number(), z.string()]).optional(),
  messaging: z.array(z.unknown()).max(MAX_EVENTS).optional(),
  field: z.string().max(80).optional(),
  value: z.unknown().optional(),
  changes: z.array(z.object({ field: z.string().max(80), value: z.unknown() }).passthrough()).max(MAX_EVENTS).optional(),
}).passthrough()
const webhookSchema = z.object({
  object: z.literal("instagram"),
  entry: z.array(entrySchema).max(MAX_ENTRIES),
}).passthrough()

export interface InstagramInboxItemInput {
  external_id: string
  instagram_account_id: string
  item_type: "message" | "comment"
  direction: "inbound" | "outbound"
  participant_id: string | null
  participant_username: string | null
  conversation_id: string | null
  media_id: string | null
  content: string | null
  attachment_type: string | null
  occurred_at: string
  source: "webhook" | "api_backfill" | "export"
  expires_at: string
}

export class InvalidInstagramWebhookError extends Error {
  constructor(public readonly reason: "schema" | "too_many_events") {
    super(`invalid_instagram_webhook:${reason}`)
    this.name = "InvalidInstagramWebhookError"
  }
}

function timestampToIso(value: string | number | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString()
  const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function expiresAt(occurredAt: string): string {
  return new Date(new Date(occurredAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
}

function hashedExternalId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function normalizeMessaging(raw: unknown, accountId: string): InstagramInboxItemInput | null {
  const parsed = messagingSchema.safeParse(raw)
  if (!parsed.success || !parsed.data.message) return null
  const { sender, recipient, message } = parsed.data
  const outbound = sender.id === accountId || message.is_echo === true
  const occurredAt = timestampToIso(parsed.data.timestamp)
  const attachmentType = message.attachments?.[0]?.type ?? null
  const content = message.is_deleted ? "[Mensaje eliminado]" : message.text?.trim() || null
  return {
    external_id: `message:${message.mid}`,
    instagram_account_id: accountId,
    item_type: "message",
    direction: outbound ? "outbound" : "inbound",
    participant_id: outbound ? recipient.id : sender.id,
    participant_username: null,
    conversation_id: null,
    media_id: null,
    content,
    attachment_type: attachmentType,
    occurred_at: occurredAt,
    source: "webhook",
    expires_at: expiresAt(occurredAt),
  }
}

function normalizeComment(
  raw: unknown,
  accountId: string,
  fallbackTime: string | number | undefined
): InstagramInboxItemInput | null {
  const parsed = commentValueSchema.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data
  const occurredAt = timestampToIso(value.created_time ?? fallbackTime)
  const participantId = value.from?.id ?? null
  return {
    external_id: `comment:${value.id}`,
    instagram_account_id: accountId,
    item_type: "comment",
    direction: participantId === accountId ? "outbound" : "inbound",
    participant_id: participantId,
    participant_username: value.from?.username?.replace(/^@/, "").trim() || null,
    conversation_id: null,
    media_id: value.media?.id ?? null,
    content: value.text?.trim() || null,
    attachment_type: null,
    occurred_at: occurredAt,
    source: "webhook",
    expires_at: expiresAt(occurredAt),
  }
}

/** Convierte los dos formatos oficiales (messaging y field/value) sin conservar el payload crudo. */
export function normalizeInstagramWebhook(input: unknown): {
  items: InstagramInboxItemInput[]
  invalidEventCount: number
} {
  const parsed = webhookSchema.safeParse(input)
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some(issue => issue.code === "too_big")
    throw new InvalidInstagramWebhookError(tooMany ? "too_many_events" : "schema")
  }

  const items: InstagramInboxItemInput[] = []
  let invalidEventCount = 0
  let eventCount = 0
  for (const entry of parsed.data.entry) {
    for (const raw of entry.messaging ?? []) {
      eventCount += 1
      if (eventCount > MAX_EVENTS) throw new InvalidInstagramWebhookError("too_many_events")
      const item = normalizeMessaging(raw, entry.id)
      if (item) items.push(item)
      else invalidEventCount += 1
    }

    const candidates = [
      ...(entry.field === "comments" ? [{ field: entry.field, value: entry.value }] : []),
      ...(entry.changes ?? []),
    ]
    for (const change of candidates) {
      if (change.field !== "comments" && change.field !== "live_comments") continue
      eventCount += 1
      if (eventCount > MAX_EVENTS) throw new InvalidInstagramWebhookError("too_many_events")
      const item = normalizeComment(change.value, entry.id, entry.time)
      if (item) items.push(item)
      else invalidEventCount += 1
    }
  }

  // Meta puede repetir el mismo cambio dentro de un lote. La DB cubre también reintentos entre lotes.
  const unique = new Map(items.map(item => [item.external_id, item]))
  return { items: [...unique.values()], invalidEventCount }
}

export function invalidInstagramExternalId(kind: "message" | "comment", value: unknown): string {
  return hashedExternalId(`invalid-${kind}`, value)
}
