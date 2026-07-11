import { NextRequest, NextResponse } from "next/server"
import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { markAsRead } from "@/lib/whatsapp"
import { isValidWhatsAppSignature } from "@/lib/whatsapp-webhook-signature"
import { claimWhatsAppEvent, markWhatsAppEventProcessed, markWhatsAppEventFailed } from "@/lib/whatsapp-idempotency"
import { sendCronFailureAlert } from "@/lib/alert-email"

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
  const rawBody = await req.text()
  const signature = req.headers.get("x-hub-signature-256")

  if (!isValidWhatsAppSignature(rawBody, signature, process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ status: "invalid_signature" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ status: "invalid_json" }, { status: 400 })
  }

  // Solo procesar eventos de WhatsApp Business
  if (body.object !== "whatsapp_business_account") {
    return NextResponse.json({ status: "ignored" })
  }

  const entries = (body.entry as unknown[]) ?? []
  let hadTransientFailure = false

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
          button?: { payload: string; text: string }
          referral?: { source_type?: string; source_id?: string; source_url?: string; ctwa_clid?: string }
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
        } else if (msg.type === "button") {
          // Respuesta a un botón de respuesta rápida de un template (no de un interactive nuestro)
          messageType = "button_reply"
          buttonId = msg.button?.payload
          text = msg.button?.text ?? ""
        } else {
          // Tipo no soportado (imagen, audio, etc.) — igualmente disparamos el bot
          // para que responda desde el estado actual de la sesión
          text = ""
        }

        if (!msg.id) {
          // Sin id de Meta no hay forma de deduplicar (no debería pasar según la spec de la API,
          // pero procesamos igual en vez de descartar el mensaje).
          try {
            await markAsRead(msg.id)
            await handleIncomingMessage({ phone, text, waName, messageType, buttonId, waMessageId: msg.id, referral: msg.referral })
          } catch (err) {
            console.error(`[whatsapp-webhook] mensaje sin id de Meta, no se pudo deduplicar (telefono=${phone}):`, err)
            hadTransientFailure = true
          }
          continue
        }

        try {
          const claim = await claimWhatsAppEvent(msg.id, phone)
          if (claim.outcome === "duplicate") continue

          await markAsRead(msg.id)
          await handleIncomingMessage({
            phone,
            text,
            waName,
            messageType,
            buttonId,
            waMessageId: msg.id,
            referral: msg.referral,
          })
          await markWhatsAppEventProcessed(msg.id)
        } catch (err) {
          const classification = await markWhatsAppEventFailed(msg.id, err).catch(() => "transient" as const)
          const errMessage = err instanceof Error ? err.message : String(err)
          console.error(`[whatsapp-webhook] evento=${msg.id} clasificacion=${classification}: ${errMessage}`)
          await sendCronFailureAlert(
            "webhook-whatsapp",
            `Fallo ${classification === "permanent" ? "definitivo" : "transitorio"} procesando el evento ${msg.id}: ${errMessage}`
          )
          if (classification === "transient") hadTransientFailure = true
        }
      }
    }
  }

  // Fallo transitorio → responder error para que Meta reintente la entrega completa; la
  // idempotencia por wa_message_id (WA-02) hace que ese reintento sea seguro: los eventos ya
  // procesados con éxito se ignoran, solo se reprocesa el que falló.
  if (hadTransientFailure) {
    return NextResponse.json({ status: "transient_error" }, { status: 500 })
  }

  return NextResponse.json({ status: "ok" })
}
