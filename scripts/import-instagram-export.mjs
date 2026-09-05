// Importa una exportación JSON ya descomprimida de Instagram sin registrar textos ni identidades.
// Uso: node --env-file=.env.local scripts/import-instagram-export.mjs <directorio-exportado>

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"

const root = process.argv[2] ? resolve(process.argv[2]) : null
if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("instagram_export_directory_required")
  process.exit(1)
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("supabase_environment_required")
  process.exit(1)
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data: config, error: configError } = await db
  .from("app_config")
  .select("key,value")
  .in("key", ["instagram_user_id", "instagram_username"])
if (configError) throw new Error("instagram_config_read_failed")
const configMap = Object.fromEntries((config ?? []).map(row => [row.key, row.value]))
const accountId = configMap.instagram_user_id == null ? null : String(configMap.instagram_user_id)
if (!accountId) throw new Error("instagram_account_id_missing")

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function decodeMetaText(value) {
  if (typeof value !== "string") return null
  let result = value
  if (/[ÃÂâð]/.test(result)) {
    try { result = Buffer.from(result, "latin1").toString("utf8") } catch { /* conserva original */ }
  }
  return result.trim() || null
}

function digest(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex")
}

function dates(timestampMs) {
  const numeric = Number(timestampMs)
  const occurred = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date()
  return {
    occurred_at: occurred.toISOString(),
    expires_at: new Date(occurred.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

function attachmentType(message) {
  if (message.photos?.length) return "image"
  if (message.videos?.length) return "video"
  if (message.audio_files?.length) return "audio"
  if (message.files?.length) return "file"
  if (message.share) return "shared_media"
  return null
}

const ownUsername = decodeMetaText(String(configMap.instagram_username ?? "")).toLowerCase()
const rows = []
const files = walk(root).filter(path => /[\\/]messages[\\/].*[\\/]message_\d+\.json$/i.test(path))
for (const path of files) {
  const thread = JSON.parse(readFileSync(path, "utf8"))
  const threadPath = typeof thread.thread_path === "string" ? thread.thread_path : relative(root, path)
  const folder = basename(resolve(path, ".."))
  const participantUsername = folder.replace(/_\d+$/, "").slice(0, 100) || null
  for (const [index, message] of (thread.messages ?? []).entries()) {
    const sender = decodeMetaText(message.sender_name) ?? ""
    const normalizedSender = sender.toLowerCase().replace(/^@/, "")
    const ownMessage = normalizedSender.includes("lucía chahin") || normalizedSender.includes("lucia chahin") || normalizedSender === ownUsername
    const content = decodeMetaText(message.content)?.slice(0, 4096) ?? null
    const attachment = attachmentType(message)
    if (!content && !attachment) continue
    rows.push({
      external_id: `export-message:${digest(threadPath, message.timestamp_ms, index, sender, content ?? attachment)}`,
      instagram_account_id: accountId,
      item_type: "message",
      direction: ownMessage ? "outbound" : "inbound",
      participant_id: null,
      participant_username: participantUsername,
      conversation_id: digest("thread", threadPath),
      media_id: null,
      content,
      attachment_type: attachment,
      ...dates(message.timestamp_ms),
      source: "export",
      updated_at: new Date().toISOString(),
    })
  }
}

const commentsPath = walk(root).find(path => path.endsWith("post_comments_1.json"))
if (commentsPath) {
  const comments = JSON.parse(readFileSync(commentsPath, "utf8"))
  for (const [index, comment] of comments.entries()) {
    const map = comment.string_map_data ?? {}
    const content = decodeMetaText(map.Comment?.value)?.slice(0, 4096) ?? null
    const timestamp = Number(map.Time?.timestamp)
    if (!content) continue
    rows.push({
      external_id: `export-comment:${digest(timestamp, index, content)}`,
      instagram_account_id: accountId,
      item_type: "comment",
      direction: "outbound",
      participant_id: null,
      participant_username: null,
      conversation_id: null,
      media_id: null,
      content,
      attachment_type: null,
      ...dates(Number.isFinite(timestamp) ? timestamp * 1000 : Date.now()),
      source: "export",
      updated_at: new Date().toISOString(),
    })
  }
}

for (let index = 0; index < rows.length; index += 100) {
  const { error } = await db.from("instagram_inbox_items").upsert(rows.slice(index, index + 100), {
    onConflict: "external_id",
  })
  if (error) throw new Error("instagram_export_import_failed")
}

console.log(JSON.stringify({ files: files.length, imported: rows.length }))
