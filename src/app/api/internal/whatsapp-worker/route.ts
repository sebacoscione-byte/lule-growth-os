import { NextResponse } from "next/server"
import {
  claimWhatsAppDeadLetterAlerts,
  drainWhatsAppInboundQueue,
  finalizeWhatsAppDeadLetterAlert,
} from "@/lib/whatsapp-inbound-queue"
import { sendCronFailureAlert } from "@/lib/alert-email"

export const maxDuration = 60

// This endpoint is also ready for a Supabase Cron/pg_net recovery call. It intentionally reuses
// CRON_SECRET so the URL/credential can be stored in Supabase Vault; no secret is embedded here.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await drainWhatsAppInboundQueue({ maxEvents: 50, timeBudgetMs: 40_000 })
    try {
      const alertClaim = await claimWhatsAppDeadLetterAlerts()
      if (alertClaim.eventCount > 0) {
        const delivered = await sendCronFailureAlert(
          "whatsapp-worker",
          `Cola WhatsApp: ${alertClaim.eventCount} evento(s) nuevo(s) en dead-letter.`
        )
        await finalizeWhatsAppDeadLetterAlert(alertClaim.claimToken, delivered)
      }
    } catch {
      // Fail-open: la alerta no cambia el ACK del worker. El cron diario revisa la salud completa.
    }
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: "worker_unavailable" }, { status: 503 })
  }
}
