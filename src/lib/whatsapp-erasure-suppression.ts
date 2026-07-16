import { getServiceDb } from "@/lib/supabase/service"

/** Intentional no-op: the source event/contact was erased while work was queued or in flight. */
export class WhatsAppErasureSuppressedError extends Error {
  constructor() {
    super("whatsapp_erasure_suppressed")
    this.name = "WhatsAppErasureSuppressedError"
  }
}

/** Fails closed if suppression state cannot be checked; callers must not contact Meta in doubt. */
export async function assertWhatsAppErasureNotSuppressed(
  phone: string | null | undefined,
  sourceKey: string | null | undefined,
  occurredAt?: string | null
): Promise<void> {
  const rpcName = occurredAt === undefined
    ? "is_whatsapp_erasure_suppressed"
    : "is_whatsapp_erasure_event_suppressed"
  const params = occurredAt === undefined
    ? { p_phone: phone ?? null, p_source_key: sourceKey ?? null }
    : {
        p_phone: phone ?? null,
        p_source_key: sourceKey ?? null,
        p_occurred_at: occurredAt ?? "1970-01-01T00:00:00.000Z",
      }
  const { data, error } = await getServiceDb().rpc(rpcName, params)
  if (error || typeof data !== "boolean") throw new Error("whatsapp_erasure_check_failed")
  if (data) throw new WhatsAppErasureSuppressedError()
}
