import { logWhatsAppMessage, incrementMessagesSentCount } from "@/lib/whatsapp-cost-tracking"
import { getApprovedTemplate, fillTemplateBody } from "@/lib/whatsapp-templates"
import type { WhatsAppCategory, WhatsAppEntryPoint, WhatsAppWindowState } from "@/types"

const WA_API_BASE = "https://graph.facebook.com/v20.0"

export interface SendContext {
  windowState: WhatsAppWindowState
  entryPoint: WhatsAppEntryPoint
  leadId?: string | null
  flowIntent?: string | null
  serviceMessageChargingEnabled: boolean
}

export class WindowClosedError extends Error {
  constructor(public phone: string) {
    super(`No se puede enviar texto libre a ${phone}: la ventana de 24h esta cerrada. Hace falta un template aprobado.`)
    this.name = "WindowClosedError"
  }
}

export class TemplateNotApprovedError extends Error {
  constructor(public templateName: string) {
    super(`El template "${templateName}" no existe o todavía no está aprobado por Meta.`)
    this.name = "TemplateNotApprovedError"
  }
}

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

function assertWindowOpen(to: string, windowState: WhatsAppWindowState) {
  if (windowState === "closed") throw new WindowClosedError(to)
}

/** Todos los mensajes free-form/interactive (texto, botones, listas) se logean como categoría "service". */
async function logOutbound(to: string, messageType: string, category: WhatsAppCategory, isTemplate: boolean, templateName: string | null, content: string, ctx: SendContext) {
  await logWhatsAppMessage({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    waId: to,
    leadId: ctx.leadId ?? null,
    direction: "outbound",
    messageType,
    category,
    isTemplate,
    templateName,
    windowState: ctx.windowState,
    entryPoint: ctx.entryPoint,
    content,
    flowIntent: ctx.flowIntent ?? null,
    serviceMessageChargingEnabled: ctx.serviceMessageChargingEnabled,
  })
  await incrementMessagesSentCount(to)
}

export async function sendText(to: string, text: string, ctx: SendContext) {
  assertWindowOpen(to, ctx.windowState)
  const result = await postToApi({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  })
  await logOutbound(to, "text", "service", false, null, text, ctx)
  return result
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  ctx: SendContext
) {
  assertWindowOpen(to, ctx.windowState)
  const result = await postToApi({
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
  await logOutbound(to, "interactive_button", "service", false, null, body, ctx)
  return result
}

export async function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  rows: Array<{ id: string; title: string }>,
  ctx: SendContext
) {
  assertWindowOpen(to, ctx.windowState)
  const result = await postToApi({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonLabel,
        sections: [{ title: "Opciones", rows }],
      },
    },
  })
  await logOutbound(to, "interactive_list", "service", false, null, body, ctx)
  return result
}

/** A diferencia de sendText/sendButtons/sendList, los templates funcionan aunque la ventana este cerrada — es su razon de ser. */
export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  params: string[],
  ctx: SendContext
) {
  const template = await getApprovedTemplate(templateName)
  if (!template) throw new TemplateNotApprovedError(templateName)

  const result = await postToApi({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(params.length
        ? { components: [{ type: "body", parameters: params.map(p => ({ type: "text", text: p })) }] }
        : {}),
    },
  })
  await logOutbound(to, "template", template.category, true, templateName, fillTemplateBody(template, params), ctx)
  return result
}

export function markAsRead(messageId: string) {
  return postToApi({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => {})
}
