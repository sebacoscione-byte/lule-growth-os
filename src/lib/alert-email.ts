const RESEND_API_URL = "https://api.resend.com/emails"

// Alerta directa por email cuando falla un cron (sin sumar infraestructura nueva tipo n8n).
// Fail-open a proposito: si todavia no esta cargado RESEND_API_KEY/ALERT_EMAIL_TO, no manda nada
// y no rompe el cron que la origino -- mismo patron que Google Analytics/Places API en este
// proyecto (ver CLAUDE.md). Setup: "Alertas de cron por email".
export async function sendCronFailureAlert(cronName: string, details: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  if (!apiKey || !to) return

  const from = process.env.ALERT_EMAIL_FROM || "Lule Growth OS <onboarding@resend.dev>"

  try {
    await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[Lule Growth OS] Fallo en cron: ${cronName}`,
        text: details,
      }),
    })
  } catch {
    // Sin reintentos: si Resend esta caido se pierde esa alerta puntual, pero no debe tumbar
    // el cron que la origino.
  }
}
