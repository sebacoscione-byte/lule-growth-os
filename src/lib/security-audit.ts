import { createHash } from "node:crypto"
import { getServiceDb } from "@/lib/supabase/service"
import type { StaffRole } from "@/lib/staff-authz"

export type SecurityAuditAction =
  | "manual_message_send"
  | "handoff_take"
  | "handoff_reactivate"
  | "handoff_close"
  | "bot_pause"
  | "bot_reactivate"
  | "config_update"
  | "lead_export"
  | "lead_correction"
  | "lead_erasure_request"

export type SecurityAuditMetadata = Record<string, string | number | boolean | null>

export interface SecurityAuditEvent {
  actorUserId: string
  actorRole: StaffRole
  action: SecurityAuditAction
  resourceType: "lead" | "whatsapp_conversation" | "configuration" | "lead_collection"
  resourceId?: string | null
  metadata?: SecurityAuditMetadata
}

export function hashAuditResourceId(resourceId: string): string {
  return createHash("sha256").update(resourceId, "utf8").digest("hex")
}

export function isSafeAuditMetadata(metadata: SecurityAuditMetadata): boolean {
  return Object.entries(metadata).every(([key, value]) => {
    if (key === "channel") return value === "whatsapp" || value === "internal"
    if (key === "ai_requested" || key === "paused") return typeof value === "boolean"
    if (key === "handoff_action") return value === "take" || value === "reactivate" || value === "close"
    if (key === "config_key") {
      return value === "doctor" || value === "locations"
        || value === "whatsapp_settings" || value === "auto_publish_settings"
    }
    if (key === "format") return value === "csv"
    if (key === "row_count") return Number.isInteger(value) && Number(value) >= 0
    if (key === "field_count") return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100
    return false
  })
}

/** Registra una acción sensible sin texto, teléfono, nombre, email ni identificadores directos. */
export async function recordSecurityAudit(event: SecurityAuditEvent): Promise<void> {
  const metadata = event.metadata ?? {}
  if (!isSafeAuditMetadata(metadata)) throw new Error("unsafe_audit_metadata")

  const db = getServiceDb()
  const { error } = await db.from("security_audit_log").insert({
    actor_user_id: event.actorUserId,
    actor_role: event.actorRole,
    action: event.action,
    resource_type: event.resourceType,
    resource_ref: event.resourceId ? hashAuditResourceId(event.resourceId) : null,
    metadata,
  })
  if (error) throw new Error("security_audit_unavailable")
}
