import { NextRequest, NextResponse } from "next/server"
import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { markAsRead } from "@/lib/whatsapp"

// Meta llama a GET para verificar el webhook al configurarlo
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse("Forbidden", { status: 403 })
}

// Meta envía mensajes entrantes como POST
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ status: "invalid_json" }, { status: 400 })
  }

  // Solo procesar eventos de WhatsApp Business
  if (body.object !== "whatsapp_business_account") {
    return NextResponse.json({ status: "ignored" })
  }

  const entries = (body.entry as unknown[]) ?? []

  for (const entry of entries) {
    const changes =
      (entry as { changes?: unknown[] }).changes ?? []

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> }).value
      if (!value) continue

      const messages = (value.messages as unknown[]) ?? []
      if (!messages.length) continue

      const contacts = (value.contacts as Array<{
        wa_id: string
        profile?: { name?: string }
      }>) ?? []

      for (const message of messages) {
        const msg = message as {
          id: string
          from: string
          type: string
          text?: { body: string }
          interactive?: {
            type: string
            button_reply?: { id: string; title: string }
            list_reply?: { id: string; title: string }
          }
        }

        const phone = msg.from
        const contact = contacts.find(c => c.wa_id === phone)
        const waName = contact?.profile?.name

        let text = ""
        let messageType: "text" | "button_reply" | "list_reply" = "text"
        let buttonId: string | undefined

        if (msg.type === "text") {
          text = msg.text?.body ?? ""
        } else if (
          msg.type === "interactive" &&
          msg.interactive?.type === "button_reply"
        ) {
          messageType = "button_reply"
          buttonId = msg.interactive.button_reply?.id
          text = msg.interactive.button_reply?.title ?? ""
        } else if (
          msg.type === "interactive" &&
          msg.interactive?.type === "list_reply"
        ) {
          messageType = "list_reply"
          buttonId = msg.interactive.list_reply?.id
          text = msg.interactive.list_reply?.title ?? ""
        } else {
          // Tipo no soportado (imagen, audio, etc.) — igualmente disparamos el bot
          // para que responda desde el estado actual de la sesión
          text = ""
        }

        try {
          await markAsRead(msg.id)
          await handleIncomingMessage({ phone, text, waName, messageType, buttonId })
        } catch (err) {
          console.error(`Error procesando mensaje WhatsApp de ${phone}:`, err)
        }
      }
    }
  }

  // Siempre responder 200 para que Meta no reintente
  return NextResponse.json({ status: "ok" })
}
