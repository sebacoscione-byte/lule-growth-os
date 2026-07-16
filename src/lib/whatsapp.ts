import { accountWhatsAppOutboundDelivery, logWhatsAppMessage, incrementMessagesSentCount } from "@/lib/whatsapp-cost-tracking"
import { getApprovedTemplate, fillTemplateBody } from "@/lib/whatsapp-templates"
import { executeWhatsAppOutboundWithLedger } from "@/lib/whatsapp-outbox"
import { getServiceDb } from "@/lib/supabase/service"
import {
  assertWhatsAppErasureNotSuppressed,
  WhatsAppErasureSuppressedError,
} from "@/lib/whatsapp-erasure-suppression"
import type { WhatsAppCategory, WhatsAppEntryPoint, WhatsAppWindowState } from "@/types"

const GRAPH_API_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/
const META_REQUEST_TIMEOUT_MS = 10_000

export class WhatsAppConfigurationError extends Error {
  constructor(public readonly code: "invalid_graph_api_version" | "missing_phone_number_id" | "missing_access_token") {
    super(code)
    this.name = "WhatsAppConfigurationError"
  }
}

export function getWhatsAppGraphApiVersion(
  value = process.env.META_GRAPH_API_VERSION ?? process.env.WHATSAPP_GRAPH_API_VERSION
): string {
  const normalized = value?.trim()
  const match = normalized?.match(GRAPH_API_VERSION_PATTERN)
  if (!normalized || !match || Number(match[0].slice(1).split(".")[0]) < 1) {
    throw new WhatsAppConfigurationError("invalid_graph_api_version")
  }
  return normalized
}

function getApiBase(): string {
  return `https://graph.facebook.com/${getWhatsAppGraphApiVersion()}`
}

export interface SendContext {
  windowState: WhatsAppWindowState
  entryPoint: WhatsAppEntryPoint
  leadId?: string | null
  flowIntent?: string | null
  /** Stable inbound Meta id. Combined with the flow step to deduplicate automatic replies. */
  sourceWaMessageId?: string | null
  /** Stable key for a proactive operation that has no inbound Meta id (for example one follow-up). */
  deliveryKey?: string | null
  outboundStep?: string | null
  /** Normal bot replies re-check ownership immediately before the Meta request. Guardrails,
   * manual messages and proactive jobs deliberately leave this false/undefined. */
  requireActiveBot?: boolean
  /** Session version observed when the inbound handler started. A staff takeover increments it. */
  expectedStateVersion?: number | null
  serviceMessageChargingEnabled: boolean
}

/** A staff takeover won the race with an already-running inbound handler. This is an intentional
 * suppression, not a provider failure and must not be retried or dead-lettered. */
export class WhatsAppAutomaticDispatchSuppressedError extends Error {
  constructor() {
    super("automatic_dispatch_suppressed")
    this.name = "WhatsAppAutomaticDispatchSuppressedError"
  }
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

/** Sanitized provider error: the response body is never copied into logs or queue rows. */
export class WhatsAppApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly providerCode: string | number | null,
    public readonly isTransient: boolean
  ) {
    super(`WhatsApp API request failed (${status})`)
    this.name = "WhatsAppApiError"
  }
}

function getPhoneNumberId() {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!id) throw new WhatsAppConfigurationError("missing_phone_number_id")
  return id
}

function getAccessToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) throw new WhatsAppConfigurationError("missing_access_token")
  return token
}

export type WhatsAppCloudApiPreflightCode =
  | WhatsAppConfigurationError["code"]
  | "provider_rejected"
  | "provider_unavailable"
  | "invalid_provider_response"
  | "phone_number_id_mismatch"

export type WhatsAppCloudApiPreflight =
  | { ok: true; code: null }
  | { ok: false; code: WhatsAppCloudApiPreflightCode }

/**
 * Read-only preflight for the production Meta configuration. It never sends a message and never
 * returns the token, phone-number ID, provider body, verified name or display phone number.
 */
export async function checkWhatsAppCloudApiConfiguration(): Promise<WhatsAppCloudApiPreflight> {
  try {
    const apiBase = getApiBase()
    const phoneNumberId = getPhoneNumberId()
    const token = getAccessToken()
    const response = await fetch(
      `${apiBase}/${encodeURIComponent(phoneNumberId)}?fields=id`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
      },
    )

    if (!response.ok) {
      return {
        ok: false,
        code: response.status >= 400 && response.status < 500
          ? "provider_rejected"
          : "provider_unavailable",
      }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, code: "invalid_provider_response" }
    }
    if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string") {
      return { ok: false, code: "invalid_provider_response" }
    }
    if ((payload as { id: string }).id !== phoneNumberId) {
      return { ok: false, code: "phone_number_id_mismatch" }
    }
    return { ok: true, code: null }
  } catch (error) {
    if (error instanceof WhatsAppConfigurationError) {
      return { ok: false, code: error.code }
    }
    return { ok: false, code: "provider_unavailable" }
  }
}

async function postToApi(body: object) {
  const res = await fetch(`${getApiBase()}/${getPhoneNumberId()}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    let providerCode: string | number | null = null
    let isTransient = res.status >= 500 || res.status === 408 || res.status === 429
    try {
      const payload = await res.json() as {
        error?: { code?: string | number; is_transient?: boolean }
      }
      providerCode = payload.error?.code ?? null
      if (typeof payload.error?.is_transient === "boolean") isTransient = payload.error.is_transient
    } catch {
      // A non-JSON provider response is intentionally discarded.
    }
    throw new WhatsAppApiError(res.status, providerCode, isTransient)
  }
  return res.json()
}

function extractSentMessageId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null
  const messages = (result as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return null
  const id = (messages[0] as { id?: unknown } | undefined)?.id
  return typeof id === "string" && id.length <= 512 ? id : null
}

function classifyDispatchFailure(error: unknown): "suppressed" | "rejected" | "ambiguous" {
  if (error instanceof WhatsAppAutomaticDispatchSuppressedError) return "suppressed"
  if (error instanceof WhatsAppErasureSuppressedError) return "suppressed"
  if (error instanceof WhatsAppConfigurationError) return "rejected"
  if (error instanceof WhatsAppApiError) {
    return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429 && !error.isTransient
      ? "rejected"
      : "ambiguous"
  }
  return "ambiguous"
}

async function assertAutomaticDispatchStillAuthorized(to: string, ctx: SendContext): Promise<void> {
  if (!ctx.requireActiveBot) return
  if (!Number.isSafeInteger(ctx.expectedStateVersion) || (ctx.expectedStateVersion ?? -1) < 0) {
    throw new Error("whatsapp_dispatch_authorization_failed")
  }
  const { data, error } = await getServiceDb().rpc("authorize_whatsapp_bot_dispatch", {
    p_phone: to,
    p_expected_state_version: ctx.expectedStateVersion,
  })
  if (error) throw new Error("whatsapp_dispatch_authorization_failed")
  if (data !== true) throw new WhatsAppAutomaticDispatchSuppressedError()
}

async function dispatchOutbound(body: object, to: string, messageType: string, ctx: SendContext) {
  const sourceKey = ctx.sourceWaMessageId ?? ctx.deliveryKey
  // Avoid creating a new ledger row for an already-erased event/contact. The callback repeats the
  // check after the atomic ledger claim to close a concurrent erasure race.
  await assertWhatsAppErasureNotSuppressed(to, sourceKey)
  return executeWhatsAppOutboundWithLedger({
    sourceKey,
    destination: to,
    flowStep: ctx.outboundStep ?? ctx.flowIntent,
    messageType,
    payload: body,
    // This check lives inside the ledger dispatch callback so it runs after the durable intent
    // claim and as close as possible to the external side effect.
    dispatch: async () => {
      await assertWhatsAppErasureNotSuppressed(to, sourceKey)
      await assertAutomaticDispatchStillAuthorized(to, ctx)
      return postToApi(body)
    },
    extractWaMessageId: extractSentMessageId,
    classifyFailure: classifyDispatchFailure,
  })
}

function assertWindowOpen(to: string, windowState: WhatsAppWindowState) {
  if (windowState === "closed") throw new WindowClosedError(to)
}

/** Todos los mensajes free-form/interactive (texto, botones, listas) se logean como categoría "service". */
async function logOutbound(to: string, messageType: string, category: WhatsAppCategory, isTemplate: boolean, templateName: string | null, content: string, ctx: SendContext, waMessageId: string | null, ledgerKey: string | null) {
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
    waMessageId,
    outboundLedgerKey: ledgerKey,
    serviceMessageChargingEnabled: ctx.serviceMessageChargingEnabled,
  })
  if (ledgerKey) await accountWhatsAppOutboundDelivery(ledgerKey, to)
  else await incrementMessagesSentCount(to)
}

export async function sendText(to: string, text: string, ctx: SendContext) {
  assertWindowOpen(to, ctx.windowState)
  const dispatch = await dispatchOutbound({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  }, to, "text", ctx)
  await logOutbound(to, "text", "service", false, null, text, ctx, extractSentMessageId(dispatch.result), dispatch.ledgerKey)
  return dispatch.result
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  ctx: SendContext
) {
  assertWindowOpen(to, ctx.windowState)
  const dispatch = await dispatchOutbound({
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
  }, to, "interactive_button", ctx)
  await logOutbound(to, "interactive_button", "service", false, null, body, ctx, extractSentMessageId(dispatch.result), dispatch.ledgerKey)
  return dispatch.result
}

export async function sendList(
  to: string,
  body: string,
  buttonLabel: string,
  rows: Array<{ id: string; title: string }>,
  ctx: SendContext
) {
  assertWindowOpen(to, ctx.windowState)
  const dispatch = await dispatchOutbound({
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
  }, to, "interactive_list", ctx)
  await logOutbound(to, "interactive_list", "service", false, null, body, ctx, extractSentMessageId(dispatch.result), dispatch.ledgerKey)
  return dispatch.result
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

  const dispatch = await dispatchOutbound({
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
  }, to, `template:${templateName}`, ctx)
  await logOutbound(to, "template", template.category, true, templateName, fillTemplateBody(template, params), ctx, extractSentMessageId(dispatch.result), dispatch.ledgerKey)
  return dispatch.result
}

export function markAsRead(messageId: string) {
  return postToApi({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => {})
}
