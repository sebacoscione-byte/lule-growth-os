import { NextResponse } from "next/server"
import { sendCronFailureAlert } from "@/lib/alert-email"

// Ruta temporal para verificar el setup de RESEND_API_KEY/ALERT_EMAIL_TO sin depender de que
// falle un cron real. No tiene ningun otro efecto secundario (no publica contenido, no manda
// WhatsApp). Borrar despues de confirmar que llega el email.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const hasKey = Boolean(process.env.RESEND_API_KEY)
  const hasTo = Boolean(process.env.ALERT_EMAIL_TO)

  await sendCronFailureAlert("test-alert", "Prueba manual: si recibiste este email, RESEND_API_KEY y ALERT_EMAIL_TO estan bien configurados en Vercel.")

  return NextResponse.json({ ok: true, hasKey, hasTo })
}
