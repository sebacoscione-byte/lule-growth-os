import type { SupabaseClient } from "@supabase/supabase-js"
import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import { getConnectionInfo, getValidToken } from "@/lib/instagram-business"

const GRAPH_BASE = "https://graph.instagram.com/v23.0"
const FETCH_TIMEOUT_MS = 10_000
const MAX_PAGES = 20
const MAX_MEDIA = 100
const MAX_CONVERSATIONS = 100
const MAX_MESSAGES_PER_CONVERSATION = 20

interface GraphPage<T> {
  data?: T[]
  paging?: { next?: string }
  error?: { message?: string }
}

export async function persistInstagramInboxItems(
  supabase: SupabaseClient,
  items: InstagramInboxItemInput[]
): Promise<number> {
  if (items.length === 0) return 0
  const { error } = await supabase
    .from("instagram_inbox_items")
    .upsert(items.map(item => ({ ...item, updated_at: new Date().toISOString() })), {
      onConflict: "external_id",
    })
  if (error) throw new Error("instagram_inbox_persist_failed")
  return items.length
}

function safeNextUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "graph.instagram.com" ? url.toString() : null
  } catch {
    return null
  }
}

async function fetchGraphPage<T>(url: string, token: string): Promise<GraphPage<T>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const body = await res.json() as GraphPage<T>
  if (!res.ok || body.error) throw new Error("instagram_graph_read_failed")
  return body
}

async function collectPages<T>(initialUrl: string, token: string, maxItems: number): Promise<T[]> {
  const result: T[] = []
  let next: string | null = initialUrl
  let page = 0
  while (next && result.length < maxItems && page < MAX_PAGES) {
    const body: GraphPage<T> = await fetchGraphPage<T>(next, token)
    result.push(...(body.data ?? []).slice(0, maxItems - result.length))
    next = safeNextUrl(body.paging?.next)
    page += 1
  }
  return result
}

function isoWithExpiry(value: string | undefined): { occurred_at: string; expires_at: string } {
  const parsed = value ? new Date(value) : new Date()
  const occurred = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return {
    occurred_at: occurred.toISOString(),
    expires_at: new Date(occurred.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

interface MediaRow { id: string }
interface CommentRow {
  id: string
  text?: string
  username?: string
  timestamp?: string
  from?: { id?: string; username?: string }
  parent_id?: string
}
interface ConversationRow {
  id: string
  participants?: { data?: Array<{ id?: string; username?: string }> }
  messages?: { data?: MessageRow[]; paging?: { next?: string } }
}
interface MessageRow {
  id: string
  created_time?: string
  from?: { id?: string; username?: string }
  to?: { data?: Array<{ id?: string; username?: string }> }
  message?: string
  attachments?: { data?: Array<{ mime_type?: string; name?: string }> }
}

export interface InstagramBackfillResult {
  mediaScanned: number
  commentsFound: number
  conversationsFound: number
  messagesFound: number
  stored: number
}

/** Backfill acotado: Meta sólo detalla los 20 mensajes más recientes por conversación. */
export async function backfillInstagramInbox(supabase: SupabaseClient): Promise<InstagramBackfillResult> {
  const [token, connection] = await Promise.all([
    getValidToken(supabase),
    getConnectionInfo(supabase),
  ])
  if (!token || !connection?.instagram_user_id) throw new Error("instagram_not_connected")
  const accountId = connection.instagram_user_id

  const mediaParams = new URLSearchParams({ fields: "id", limit: "50" })
  const media = await collectPages<MediaRow>(`${GRAPH_BASE}/me/media?${mediaParams}`, token, MAX_MEDIA)
  const commentItems: InstagramInboxItemInput[] = []
  // Lotes chicos evitan tanto una espera serial larga como una ráfaga de 100 requests a Meta.
  for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex += 5) {
    const batch = media.slice(mediaIndex, mediaIndex + 5)
    const results = await Promise.all(batch.map(async item => {
      const params = new URLSearchParams({
        fields: "id,text,username,timestamp,from,parent_id",
        limit: "100",
      })
      const comments = await collectPages<CommentRow>(
        `${GRAPH_BASE}/${encodeURIComponent(item.id)}/comments?${params}`,
        token,
        500
      )
      return { item, comments }
    }))
    for (const { item, comments } of results) for (const comment of comments) {
      const dates = isoWithExpiry(comment.timestamp)
      const participantId = comment.from?.id ?? null
      commentItems.push({
        external_id: `comment:${comment.id}`,
        instagram_account_id: accountId,
        item_type: "comment",
        direction: participantId === accountId ? "outbound" : "inbound",
        participant_id: participantId,
        participant_username: comment.from?.username ?? comment.username ?? null,
        conversation_id: null,
        media_id: item.id,
        content: comment.text?.trim() || null,
        attachment_type: null,
        ...dates,
        source: "api_backfill",
      })
    }
  }

  const conversationParams = new URLSearchParams({
    fields: `id,participants,messages.limit(${MAX_MESSAGES_PER_CONVERSATION}){id,created_time,from,to,message,attachments}`,
    limit: "50",
  })
  const conversations = await collectPages<ConversationRow>(
    `${GRAPH_BASE}/me/conversations?${conversationParams}`,
    token,
    MAX_CONVERSATIONS
  )
  const messageItems: InstagramInboxItemInput[] = []
  for (const conversation of conversations) {
    const participants = conversation.participants?.data ?? []
    const other = participants.find(participant => participant.id && participant.id !== accountId)
    for (const message of (conversation.messages?.data ?? []).slice(0, MAX_MESSAGES_PER_CONVERSATION)) {
      const senderId = message.from?.id ?? null
      const outbound = senderId === accountId
      const recipient = message.to?.data?.find(item => item.id && item.id !== accountId)
      const dates = isoWithExpiry(message.created_time)
      messageItems.push({
        external_id: `message:${message.id}`,
        instagram_account_id: accountId,
        item_type: "message",
        direction: outbound ? "outbound" : "inbound",
        participant_id: outbound ? recipient?.id ?? other?.id ?? null : senderId ?? other?.id ?? null,
        participant_username: outbound
          ? recipient?.username ?? other?.username ?? null
          : message.from?.username ?? other?.username ?? null,
        conversation_id: conversation.id,
        media_id: null,
        content: message.message?.trim() || null,
        attachment_type: message.attachments?.data?.[0]?.mime_type ?? message.attachments?.data?.[0]?.name ?? null,
        ...dates,
        source: "api_backfill",
      })
    }
  }

  const allItems = [...commentItems, ...messageItems]
  const stored = await persistInstagramInboxItems(supabase, allItems)
  return {
    mediaScanned: media.length,
    commentsFound: commentItems.length,
    conversationsFound: conversations.length,
    messagesFound: messageItems.length,
    stored,
  }
}

export async function subscribeInstagramAccount(supabase: SupabaseClient): Promise<void> {
  const [token, connection] = await Promise.all([
    getValidToken(supabase),
    getConnectionInfo(supabase),
  ])
  if (!token || !connection?.instagram_user_id) throw new Error("instagram_not_connected")
  const params = new URLSearchParams({ subscribed_fields: "messages,comments" })
  const res = await fetch(
    `${GRAPH_BASE}/${encodeURIComponent(connection.instagram_user_id)}/subscribed_apps?${params}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  )
  const body = await res.json() as { success?: boolean; error?: unknown }
  if (!res.ok || body.success !== true) throw new Error("instagram_subscription_failed")
}
