import { getServiceDb } from "@/lib/supabase/service"
import { WindowClosedError, TemplateNotApprovedError } from "@/lib/whatsapp"

export type WebhookEventStatus = "processing" | "processed" | "failed_transient" | "failed_permanent"
export type ClaimOutcome = "claim" | "duplicate" | "retry"
export type ErrorClassification = "transient" | "permanent"

const TABLE = "whatsapp_webhook_events"
const UNIQUE_VIOLATION = "23505"

/**
 * Decide qué hacer con un wa_message_id ya visto antes, según en qué estado haya quedado su fila:
 * - sin fila todavía → reclamarlo y procesar (caso normal, primera entrega).
 * - failed_transient → un intento anterior falló de forma reintentable, se puede reprocesar.
 * - processing/processed/failed_permanent → ya se está procesando, ya se procesó con éxito, o
 *   falló de forma definitiva — en los tres casos, un reintento no debe volver a ejecutar nada.
 */
export function decideClaimOutcome(existingStatus: WebhookEventStatus | null): ClaimOutcome {
  if (existingStatus === null) return "claim"
  if (existingStatus === "failed_transient") return "retry"
  return "duplicate"
}

/**
 * Clasifica un error de procesamiento como reintentable o definitivo. Por defecto conservador:
 * si no se puede clasificar, se trata como transitorio — perder un mensaje silenciosamente es peor
 * que un reintento de más, y la idempotencia por wa_message_id hace que ese reintento sea seguro.
 * Los únicos errores que se saben definitivos hoy son guardas deterministas (ventana cerrada,
 * template no aprobado) que van a volver a fallar igual ante el mismo evento.
 */
export function classifyWebhookError(error: unknown): ErrorClassification {
  if (error instanceof WindowClosedError) return "permanent"
  if (error instanceof TemplateNotApprovedError) return "permanent"
  return "transient"
}

export interface ClaimResult {
  outcome: ClaimOutcome
}

/** Reclama el wa_message_id antes de tocar sesión, costo o enviar cualquier respuesta (WA-02). */
export async function claimWhatsAppEvent(waMessageId: string, phone: string): Promise<ClaimResult> {
  const db = getServiceDb()

  const { error: insertError } = await db
    .from(TABLE)
    .insert({ wa_message_id: waMessageId, phone, status: "processing" })

  if (!insertError) return { outcome: "claim" }

  if (insertError.code !== UNIQUE_VIOLATION) {
    throw new Error(`Error reclamando evento de WhatsApp ${waMessageId}: ${insertError.message}`)
  }

  const { data: existing } = await db
    .from(TABLE)
    .select("status")
    .eq("wa_message_id", waMessageId)
    .maybeSingle()

  const outcome = decideClaimOutcome((existing?.status as WebhookEventStatus | undefined) ?? null)
  if (outcome !== "retry") return { outcome }

  // Reclamar el reintento de forma atómica: si otro reintento concurrente ya lo tomó, esta
  // condición no matchea ninguna fila y hay que tratarlo como duplicado.
  const { data: reclaimed } = await db
    .from(TABLE)
    .update({ status: "processing" })
    .eq("wa_message_id", waMessageId)
    .eq("status", "failed_transient")
    .select("wa_message_id")
    .maybeSingle()

  return { outcome: reclaimed ? "retry" : "duplicate" }
}

export async function markWhatsAppEventProcessed(waMessageId: string): Promise<void> {
  await getServiceDb()
    .from(TABLE)
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("wa_message_id", waMessageId)
}

/** Devuelve la clasificación para que el caller decida si el webhook responde error (reintentable) u ok (definitivo). */
export async function markWhatsAppEventFailed(waMessageId: string, error: unknown): Promise<ErrorClassification> {
  const classification = classifyWebhookError(error)
  const message = error instanceof Error ? error.message : String(error)

  await getServiceDb()
    .from(TABLE)
    .update({
      status: classification === "permanent" ? "failed_permanent" : "failed_transient",
      last_error: message.slice(0, 500),
    })
    .eq("wa_message_id", waMessageId)

  return classification
}
