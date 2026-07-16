const RESEND_API_URL = "https://api.resend.com/emails"
const ALERT_EMAIL_TIMEOUT_MS = 5_000

// Alerta directa por email (sin sumar infraestructura nueva tipo n8n). Fail-open a proposito: si
// todavia no esta cargado RESEND_API_KEY/ALERT_EMAIL_TO, no manda nada y no rompe quien la origino
// -- mismo patron que Google Analytics/Places API en este proyecto (ver CLAUDE.md). Setup:
// "Alertas de cron por email".
async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  if (!apiKey || !to) return false

  const from = process.env.ALERT_EMAIL_FROM || "Lule Growth OS <onboarding@resend.dev>"

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(ALERT_EMAIL_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    // Sin reintentos: si Resend esta caido se pierde esa alerta puntual, pero no debe tumbar
    // el proceso que la origino.
    return false
  }
}

export async function sendCronFailureAlert(cronName: string, details: string): Promise<boolean> {
  return sendAlertEmail(`[Lule Growth OS] Fallo en cron: ${cronName}`, details)
}

// Ola 4 (incidente real 2026-07-14): antes de esto, escalar a un humano solo quedaba registrado en
// la base -- nadie se enteraba hasta abrir /inbox a mano. Ver escalateToHuman() en whatsapp-handoff.ts.
export async function sendHandoffAlert(details: string): Promise<void> {
  await sendAlertEmail("[Lule Growth OS] Un paciente pidió hablar con una persona", details)
}

// Respaldo diario (corre dentro del cron ya existente, ver whatsapp-handoff.ts) por si la alerta
// puntual de arriba se pierde o se ignora -- ver Ola 4 del backlog.
export async function sendHandoffReminderAlert(details: string): Promise<void> {
  await sendAlertEmail("[Lule Growth OS] Pacientes esperando respuesta humana", details)
}
