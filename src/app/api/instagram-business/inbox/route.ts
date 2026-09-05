import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { backfillInstagramInbox, subscribeInstagramAccount } from "@/lib/instagram-inbox"
import { recordSecurityAudit } from "@/lib/security-audit"

const READ_ROLES = ["owner", "doctor", "reception"] as const
const SYNC_ROLES = ["owner"] as const
export const maxDuration = 60

export async function GET(request: Request) {
  const authClient = await createClient()
  const auth = await authorizeStaff(authClient, { allowedRoles: READ_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type")
  const db = getServiceDb()
  let query = db
    .from("instagram_inbox_items")
    .select("id,item_type,direction,participant_username,content,attachment_type,occurred_at,source")
    .gt("expires_at", new Date().toISOString())
    .order("occurred_at", { ascending: false })
    .limit(500)
  if (type === "message" || type === "comment") query = query.eq("item_type", type)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: "No se pudo leer Instagram" }, { status: 503 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST() {
  const authClient = await createClient()
  const auth = await authorizeStaff(authClient, { allowedRoles: SYNC_ROLES, sensitive: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })

  const db = getServiceDb()
  try {
    await recordSecurityAudit({
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "config_update",
      resourceType: "configuration",
      metadata: { config_key: "instagram_inbox" },
    })
  } catch {
    return NextResponse.json({ error: "No se pudo registrar la acción de seguridad" }, { status: 503 })
  }

  let subscribed = false
  try {
    await subscribeInstagramAccount(db)
    subscribed = true
  } catch {
    // El backfill puede seguir siendo útil aunque Meta todavía no permita la suscripción en vivo.
  }

  try {
    const result = await backfillInstagramInbox(db)
    return NextResponse.json({ ...result, subscribed })
  } catch {
    return NextResponse.json({ error: "No se pudo sincronizar Instagram", subscribed }, { status: 502 })
  }
}
