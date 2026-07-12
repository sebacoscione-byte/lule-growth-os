import { GET, POST } from "./route"

jest.mock("@/lib/whatsapp-webhook-signature", () => ({ isValidWhatsAppSignature: jest.fn() }))
jest.mock("@/lib/whatsapp-idempotency", () => ({
  claimWhatsAppEvent: jest.fn(),
  markWhatsAppEventProcessed: jest.fn(),
  markWhatsAppEventFailed: jest.fn(),
}))
jest.mock("@/lib/whatsapp-bot", () => ({ handleIncomingMessage: jest.fn() }))
jest.mock("@/lib/whatsapp", () => ({ markAsRead: jest.fn() }))
jest.mock("@/lib/alert-email", () => ({ sendCronFailureAlert: jest.fn() }))

import { isValidWhatsAppSignature } from "@/lib/whatsapp-webhook-signature"
import { claimWhatsAppEvent, markWhatsAppEventProcessed, markWhatsAppEventFailed } from "@/lib/whatsapp-idempotency"
import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { sendCronFailureAlert } from "@/lib/alert-email"

const ORIGINAL_ENV = process.env

function incomingMessagePayload(overrides?: Partial<{ id: string; from: string; text: string }>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: overrides?.from ?? "5491100000000", profile: { name: "Paciente" } }],
              messages: [
                {
                  id: overrides?.id ?? "wamid.ABC123",
                  from: overrides?.from ?? "5491100000000",
                  type: "text",
                  text: { body: overrides?.text ?? "Hola" },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("GET /api/webhooks/whatsapp — verificación de Meta", () => {
  it("devuelve el challenge si el modo y el token son correctos", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "token-secreto"
    const req = new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-secreto&hub.challenge=xyz"
    )
    const res = await GET(req as never)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("xyz")
  })

  it("rechaza con 403 si el token no coincide", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "token-secreto"
    const req = new Request(
      "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-incorrecto&hub.challenge=xyz"
    )
    const res = await GET(req as never)
    expect(res.status).toBe(403)
  })
})

describe("POST /api/webhooks/whatsapp — firma", () => {
  it("rechaza con 401 si la firma es inválida (WA-01, fail-closed)", async () => {
    ;(isValidWhatsAppSignature as jest.Mock).mockReturnValue(false)
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(incomingMessagePayload()),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(401)
    expect(handleIncomingMessage).not.toHaveBeenCalled()
  })

  it("rechaza con 400 si el body no es JSON válido", async () => {
    ;(isValidWhatsAppSignature as jest.Mock).mockReturnValue(true)
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: "esto no es json",
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/webhooks/whatsapp — procesamiento de mensajes", () => {
  beforeEach(() => {
    ;(isValidWhatsAppSignature as jest.Mock).mockReturnValue(true)
  })

  it("ignora eventos que no son de whatsapp_business_account", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify({ object: "otra_cosa" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ignored" })
    expect(handleIncomingMessage).not.toHaveBeenCalled()
  })

  it("procesa un mensaje nuevo (claim) y lo marca como procesado", async () => {
    ;(claimWhatsAppEvent as jest.Mock).mockResolvedValue({ outcome: "claim" })
    ;(handleIncomingMessage as jest.Mock).mockResolvedValue(undefined)
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(incomingMessagePayload()),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok" })
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1)
    expect(markWhatsAppEventProcessed).toHaveBeenCalledWith("wamid.ABC123")
  })

  it("WA-02: un evento duplicado no vuelve a disparar el bot", async () => {
    ;(claimWhatsAppEvent as jest.Mock).mockResolvedValue({ outcome: "duplicate" })
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(incomingMessagePayload()),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(handleIncomingMessage).not.toHaveBeenCalled()
    expect(markWhatsAppEventProcessed).not.toHaveBeenCalled()
  })

  it("WA-03: una falla transitoria responde 500 para que Meta reintente", async () => {
    ;(claimWhatsAppEvent as jest.Mock).mockResolvedValue({ outcome: "claim" })
    ;(handleIncomingMessage as jest.Mock).mockRejectedValue(new Error("fallo de red"))
    ;(markWhatsAppEventFailed as jest.Mock).mockResolvedValue("transient")
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(incomingMessagePayload()),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ status: "transient_error" })
    expect(sendCronFailureAlert).toHaveBeenCalled()
  })

  it("una falla permanente (ventana cerrada / template no aprobado) no pide reintento", async () => {
    ;(claimWhatsAppEvent as jest.Mock).mockResolvedValue({ outcome: "claim" })
    ;(handleIncomingMessage as jest.Mock).mockRejectedValue(new Error("template no aprobado"))
    ;(markWhatsAppEventFailed as jest.Mock).mockResolvedValue("permanent")
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      body: JSON.stringify(incomingMessagePayload()),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok" })
  })
})
