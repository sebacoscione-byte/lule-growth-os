jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server")
  return { ...actual, after: jest.fn() }
})
jest.mock("@/lib/whatsapp-webhook-signature", () => ({ isValidWhatsAppSignature: jest.fn() }))
jest.mock("@/lib/whatsapp-inbound-queue", () => ({
  enqueueWhatsAppEvents: jest.fn(),
  drainWhatsAppInboundQueue: jest.fn(),
}))

import { after } from "next/server"
import { GET, POST } from "./route"
import { isValidWhatsAppSignature } from "@/lib/whatsapp-webhook-signature"
import { drainWhatsAppInboundQueue, enqueueWhatsAppEvents } from "@/lib/whatsapp-inbound-queue"

const ORIGINAL_ENV = process.env

function incomingMessagePayload(message: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "123456789" },
          contacts: [{ wa_id: "5491100000000", profile: { name: "Paciente" } }],
          messages: [{
            id: "wamid.ABC123",
            from: "5491100000000",
            timestamp: "1784160000",
            type: "text",
            text: { body: "Hola" },
            ...message,
          }],
        },
      }],
    }],
  }
}

function postRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=test", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  ;(isValidWhatsAppSignature as jest.Mock).mockReturnValue(true)
  ;(enqueueWhatsAppEvents as jest.Mock).mockResolvedValue(1)
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789"
})
afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("GET /api/webhooks/whatsapp", () => {
  it("devuelve el challenge solo con el token correcto", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "token-secreto"
    const ok = await GET(new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-secreto&hub.challenge=xyz"
    ) as never)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe("xyz")

    const forbidden = await GET(new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=xyz"
    ) as never)
    expect(forbidden.status).toBe(403)
  })
})

describe("POST /api/webhooks/whatsapp — durable ACK", () => {
  it("persiste los mensajes del receptor de alertas si tambien usa el numero para probar el bot", async () => {
    process.env.ALERT_WHATSAPP_TO = "+54 9 11 2384-2117"
    const payload = incomingMessagePayload({ from: "5491123842117" })
    payload.entry[0].changes[0].value.contacts[0].wa_id = "5491123842117"

    const response = await POST(postRequest(payload) as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "accepted", queued: 1, invalid_events: 0, ignored_numbers: 0,
    })
    expect(enqueueWhatsAppEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: "inbound", phone: "5491123842117" }),
    ])
    expect(after).toHaveBeenCalledTimes(1)
  })

  it("rechaza firma inválida fail-closed sin persistir", async () => {
    ;(isValidWhatsAppSignature as jest.Mock).mockReturnValue(false)
    const response = await POST(postRequest(incomingMessagePayload()) as never)
    expect(response.status).toBe(401)
    expect(enqueueWhatsAppEvents).not.toHaveBeenCalled()
  })

  it("valida content-type, JSON y límite de body", async () => {
    const wrongType = postRequest(incomingMessagePayload(), { "content-type": "text/plain" })
    expect((await POST(wrongType as never)).status).toBe(415)

    expect((await POST(postRequest("no-json") as never)).status).toBe(400)

    const tooLarge = postRequest({}, { "content-length": String(300 * 1024) })
    expect((await POST(tooLarge as never)).status).toBe(413)
  })

  it("persiste primero, agenda after() y responde 200 sin ejecutar el worker inline", async () => {
    const response = await POST(postRequest(incomingMessagePayload()) as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "accepted", queued: 1, invalid_events: 0, ignored_numbers: 0 })
    expect(enqueueWhatsAppEvents).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    expect(drainWhatsAppInboundQueue).not.toHaveBeenCalled()
  })

  it("el acelerador post-ACK drena un lote amplio y absorbe fallas sin cambiar el ACK", async () => {
    const response = await POST(postRequest(incomingMessagePayload()) as never)
    const callback = (after as jest.Mock).mock.calls[0][0] as () => Promise<void>
    ;(drainWhatsAppInboundQueue as jest.Mock).mockRejectedValue(new Error("detalle sensible"))
    await expect(callback()).resolves.toBeUndefined()
    expect(drainWhatsAppInboundQueue).toHaveBeenCalledWith({ maxEvents: 100, timeBudgetMs: 45_000 })
    expect(response.status).toBe(200)
  })

  it("conserva el tipo real del adjunto sin persistir su id ni descargarlo", async () => {
    const payload = incomingMessagePayload({
      type: "audio",
      text: undefined,
      audio: { id: "media-sensitive-id", mime_type: "audio/ogg" },
    })
    const response = await POST(postRequest(payload) as never)
    expect(response.status).toBe(200)

    const events = (enqueueWhatsAppEvents as jest.Mock).mock.calls[0][0]
    expect(events[0].message_type).toBe("audio")
    expect(events[0].message_text).toBe("")
    expect(JSON.stringify(events[0])).not.toContain("media-sensitive-id")
  })

  it("no llama markAsRead ni procesa mensajes sin id: los cuenta como inválidos", async () => {
    const payload = incomingMessagePayload({ id: undefined })
    const response = await POST(postRequest(payload) as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "accepted", queued: 1, invalid_events: 1, ignored_numbers: 0 })
    const events = (enqueueWhatsAppEvents as jest.Mock).mock.calls[0][0]
    expect(events[0]).toEqual(expect.objectContaining({ phone: null, message_text: null }))
    expect(after).toHaveBeenCalledTimes(1)
  })

  it("pide reintento a Meta si no pudo persistir de forma durable", async () => {
    ;(enqueueWhatsAppEvents as jest.Mock).mockRejectedValue(new Error("database details"))
    const response = await POST(postRequest(incomingMessagePayload()) as never)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "queue_unavailable" })
    expect(after).not.toHaveBeenCalled()
  })

  it("ignora objetos ajenos a WhatsApp Business", async () => {
    const response = await POST(postRequest({ object: "other" }) as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ignored" })
    expect(enqueueWhatsAppEvents).not.toHaveBeenCalled()
  })

  it("no procesa eventos firmados para otro phone_number_id", async () => {
    const payload = incomingMessagePayload()
    payload.entry[0].changes[0].value.metadata.phone_number_id = "987654321"
    const response = await POST(postRequest(payload) as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "accepted", queued: 0, invalid_events: 0, ignored_numbers: 1,
    })
    expect(enqueueWhatsAppEvents).toHaveBeenCalledWith([])
    expect(after).not.toHaveBeenCalled()
  })
})
