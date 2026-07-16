jest.mock("./whatsapp-cost-tracking", () => ({
  logWhatsAppMessage: jest.fn().mockResolvedValue({ costEstimated: 0 }),
  incrementMessagesSentCount: jest.fn().mockResolvedValue(1),
  accountWhatsAppOutboundDelivery: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("./whatsapp-templates", () => ({
  getApprovedTemplate: jest.fn(),
  fillTemplateBody: jest.fn().mockReturnValue("cuerpo del template"),
}))

jest.mock("./whatsapp-outbox", () => ({
  executeWhatsAppOutboundWithLedger: jest.fn(async (options: { dispatch: () => Promise<unknown> }) => ({
    result: await options.dispatch(), ledgerKey: null, replayedAccepted: false,
  })),
}))

jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp-erasure-suppression", () => ({
  assertWhatsAppErasureNotSuppressed: jest.fn().mockResolvedValue(undefined),
  WhatsAppErasureSuppressedError: class WhatsAppErasureSuppressedError extends Error {},
}))

import {
  checkWhatsAppCloudApiConfiguration,
  getWhatsAppGraphApiVersion,
  sendText,
  sendTemplate,
  WhatsAppApiError,
  WhatsAppConfigurationError,
  WhatsAppAutomaticDispatchSuppressedError,
  WindowClosedError,
  TemplateNotApprovedError,
  type SendContext,
} from "@/lib/whatsapp"
import { getApprovedTemplate } from "./whatsapp-templates"
import { accountWhatsAppOutboundDelivery, incrementMessagesSentCount, logWhatsAppMessage } from "./whatsapp-cost-tracking"
import { executeWhatsAppOutboundWithLedger } from "./whatsapp-outbox"
import { getServiceDb } from "@/lib/supabase/service"

const baseCtx: SendContext = {
  windowState: "open",
  entryPoint: "organic",
  deliveryKey: "test-outbound-event",
  flowIntent: "test_outbound",
  serviceMessageChargingEnabled: false,
}

describe("checkWhatsAppCloudApiConfiguration", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    process.env.WHATSAPP_ACCESS_TOKEN = "token"
    process.env.META_GRAPH_API_VERSION = "v25.0"
    delete process.env.WHATSAPP_GRAPH_API_VERSION
  })

  it("valida version, token e ID con un GET que no envia mensajes", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "123", display_phone_number: "dato-que-no-se-devuelve" }),
    }) as unknown as typeof fetch

    await expect(checkWhatsAppCloudApiConfiguration()).resolves.toEqual({ ok: true, code: null })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/123?fields=id",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer token" },
      }),
    )
  })

  it("falla cerrado antes del request si falta la version", async () => {
    delete process.env.META_GRAPH_API_VERSION
    global.fetch = jest.fn() as unknown as typeof fetch

    await expect(checkWhatsAppCloudApiConfiguration()).resolves.toEqual({
      ok: false,
      code: "invalid_graph_api_version",
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("reduce errores de Meta a un codigo cerrado sin copiar el body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "token y datos sensibles" } }),
    }) as unknown as typeof fetch

    const result = await checkWhatsAppCloudApiConfiguration()
    expect(result).toEqual({ ok: false, code: "provider_rejected" })
    expect(JSON.stringify(result)).not.toContain("token y datos sensibles")
  })

  it("rechaza una respuesta que no confirma el ID configurado", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "otro-id" }),
    }) as unknown as typeof fetch

    await expect(checkWhatsAppCloudApiConfiguration()).resolves.toEqual({
      ok: false,
      code: "phone_number_id_mismatch",
    })
  })
})

describe("sendText — gate de ventana de 24h", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    process.env.WHATSAPP_ACCESS_TOKEN = "token"
    process.env.META_GRAPH_API_VERSION = "v23.0"
    delete process.env.WHATSAPP_GRAPH_API_VERSION
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
  })

  it("con la ventana abierta envia el mensaje de texto libre normalmente", async () => {
    await sendText("5491100000000", "hola", baseCtx)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("integra el ledger con el id entrante y el paso de flujo", async () => {
    await sendText("5491100000000", "hola", {
      ...baseCtx,
      sourceWaMessageId: "wamid.inbound-1",
      flowIntent: "consent_request",
    })
    expect(executeWhatsAppOutboundWithLedger).toHaveBeenCalledWith(expect.objectContaining({
      sourceKey: "wamid.inbound-1",
      destination: "5491100000000",
      flowStep: "consent_request",
      messageType: "text",
    }))
  })

  it("revalida version y ownership del bot inmediatamente antes del request", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await sendText("5491100000000", "hola", {
      ...baseCtx,
      sourceWaMessageId: "wamid.inbound-cas",
      flowIntent: "consent_request",
      requireActiveBot: true,
      expectedStateVersion: 7,
    })

    expect(rpc).toHaveBeenCalledWith("authorize_whatsapp_bot_dispatch", {
      p_phone: "5491100000000",
      p_expected_state_version: 7,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("suprime el envio si una persona tomo la conversacion durante el handler", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await expect(sendText("5491100000000", "hola", {
      ...baseCtx,
      sourceWaMessageId: "wamid.inbound-takeover",
      flowIntent: "consent_request",
      requireActiveBot: true,
      expectedStateVersion: 7,
    })).rejects.toBeInstanceOf(WhatsAppAutomaticDispatchSuppressedError)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(logWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("un replay accepted usa logging/accounting idempotente en vez de incrementar a ciegas", async () => {
    ;(executeWhatsAppOutboundWithLedger as jest.Mock).mockResolvedValueOnce({
      result: { messages: [{ id: "wamid.outbound-ledger" }] },
      ledgerKey: "a".repeat(64),
      replayedAccepted: true,
    })
    await sendText("5491100000000", "hola", {
      ...baseCtx,
      sourceWaMessageId: "wamid.inbound-1",
      flowIntent: "consent_request",
    })
    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      outboundLedgerKey: "a".repeat(64),
      waMessageId: "wamid.outbound-ledger",
    }))
    expect(accountWhatsAppOutboundDelivery).toHaveBeenCalledWith("a".repeat(64), "5491100000000")
    expect(incrementMessagesSentCount).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("usa una versión configurable válida y falla cerrado para valores inválidos", async () => {
    process.env.META_GRAPH_API_VERSION = "v24.0"
    await sendText("5491100000000", "hola", baseCtx)
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/123/messages",
      expect.any(Object)
    )

    expect(() => getWhatsAppGraphApiVersion("../../otro-host")).toThrow(WhatsAppConfigurationError)
    expect(() => getWhatsAppGraphApiVersion("")).toThrow("invalid_graph_api_version")
  })

  it("guarda el wa_message_id de la respuesta para conciliar estados de entrega", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.outbound-1" }] }),
    }) as unknown as typeof fetch
    await sendText("5491100000000", "hola", baseCtx)
    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      waMessageId: "wamid.outbound-1",
    }))
  })

  it("descarta el body libre de errores de Meta", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 131026, is_transient: false, message: "token secreto y teléfono" },
      }),
    }) as unknown as typeof fetch

    const promise = sendText("5491100000000", "hola", baseCtx)
    await expect(promise).rejects.toBeInstanceOf(WhatsAppApiError)
    await expect(promise).rejects.not.toThrow("token secreto")
    expect(logWhatsAppMessage).not.toHaveBeenCalled()
  })

  it("con la ventana cerrada bloquea el envio de texto libre y no llama a la API de Meta", async () => {
    await expect(sendText("5491100000000", "hola", { ...baseCtx, windowState: "closed" }))
      .rejects.toThrow(WindowClosedError)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("sendTemplate — funciona sin importar la ventana, pero exige template aprobado", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    process.env.WHATSAPP_ACCESS_TOKEN = "token"
    process.env.META_GRAPH_API_VERSION = "v23.0"
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
  })

  it("envia un template aprobado aunque la ventana este cerrada", async () => {
    ;(getApprovedTemplate as jest.Mock).mockResolvedValue({
      id: "1", name: "recordatorio_turno", category: "utility", language: "es_AR", status: "aprobado",
      body_text: "Hola {{1}}", variables: ["nombre"],
    })

    await sendTemplate("5491100000000", "recordatorio_turno", "es_AR", ["Juana"], { ...baseCtx, windowState: "closed" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("sin template aprobado no envia nada y lanza TemplateNotApprovedError", async () => {
    ;(getApprovedTemplate as jest.Mock).mockResolvedValue(null)

    await expect(sendTemplate("5491100000000", "template_inexistente", "es_AR", [], { ...baseCtx, windowState: "closed" }))
      .rejects.toThrow(TemplateNotApprovedError)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
