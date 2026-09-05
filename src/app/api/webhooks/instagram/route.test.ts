jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn(() => ({ db: true })) }))
jest.mock("@/lib/instagram-webhook-signature", () => ({ isValidInstagramSignature: jest.fn() }))
jest.mock("@/lib/instagram-inbox", () => ({ persistInstagramInboxItems: jest.fn() }))

import { GET, POST } from "./route"
import { isValidInstagramSignature } from "@/lib/instagram-webhook-signature"
import { persistInstagramInboxItems } from "@/lib/instagram-inbox"

const ORIGINAL_ENV = process.env

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/instagram", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=test", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

function payload() {
  return {
    object: "instagram",
    entry: [{
      id: "ig-business",
      messaging: [{
        sender: { id: "person-1" }, recipient: { id: "ig-business" }, timestamp: 1788638400000,
        message: { mid: "mid-1", text: "Hola" },
      }],
    }],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, INSTAGRAM_APP_SECRET: "secret", INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify" }
  ;(isValidInstagramSignature as jest.Mock).mockReturnValue(true)
  ;(persistInstagramInboxItems as jest.Mock).mockResolvedValue(1)
})
afterAll(() => { process.env = ORIGINAL_ENV })

describe("GET /api/webhooks/instagram", () => {
  it("entrega el challenge sólo con el token correcto", async () => {
    const ok = await GET(new Request("http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123"))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe("123")
    const denied = await GET(new Request("http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=no&hub.challenge=123"))
    expect(denied.status).toBe(403)
  })
})

describe("POST /api/webhooks/instagram", () => {
  it("verifica, minimiza y persiste antes del 200", async () => {
    const response = await POST(request(payload()))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "accepted", stored: 1, invalid_events: 0 })
    expect(persistInstagramInboxItems).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ external_id: "message:mid-1", content: "Hola" }),
    ])
  })

  it("falla cerrado ante firma inválida y no escribe", async () => {
    ;(isValidInstagramSignature as jest.Mock).mockReturnValue(false)
    const response = await POST(request(payload()))
    expect(response.status).toBe(401)
    expect(persistInstagramInboxItems).not.toHaveBeenCalled()
  })

  it("valida content type, tamaño, JSON y objeto", async () => {
    expect((await POST(request(payload(), { "content-type": "text/plain" }))).status).toBe(415)
    expect((await POST(request({}, { "content-length": String(300 * 1024) }))).status).toBe(413)
    expect((await POST(request("no-json"))).status).toBe(400)
    const ignored = await POST(request({ object: "other" }))
    expect(await ignored.json()).toEqual({ status: "ignored" })
  })

  it("pide reintento si la persistencia falla", async () => {
    ;(persistInstagramInboxItems as jest.Mock).mockRejectedValue(new Error("sensitive detail"))
    const response = await POST(request(payload()))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: "storage_unavailable" })
  })
})
