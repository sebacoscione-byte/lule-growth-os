const WA_API_BASE = "https://graph.facebook.com/v20.0"

function getPhoneNumberId() {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID no configurado")
  return id
}

function getAccessToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN no configurado")
  return token
}

async function postToApi(body: object) {
  const res = await fetch(`${WA_API_BASE}/${getPhoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WhatsApp API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function sendText(to: string, text: string) {
  return postToApi({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  })
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>
) {
  return postToApi({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  })
}

export function markAsRead(messageId: string) {
  return postToApi({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => {})
}
