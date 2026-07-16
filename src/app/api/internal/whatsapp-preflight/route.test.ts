jest.mock("@/lib/whatsapp", () => ({
  checkWhatsAppCloudApiConfiguration: jest.fn(),
}))

import { checkWhatsAppCloudApiConfiguration } from "@/lib/whatsapp"
import { GET } from "./route"

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("GET /api/internal/whatsapp-preflight", () => {
  it("falla cerrado sin CRON_SECRET", async () => {
    delete process.env.CRON_SECRET
    const response = await GET(new Request("http://localhost/api/internal/whatsapp-preflight"))

    expect(response.status).toBe(401)
    expect(checkWhatsAppCloudApiConfiguration).not.toHaveBeenCalled()
  })

  it("confirma una configuracion valida sin exponer IDs", async () => {
    process.env.CRON_SECRET = "cron-secret"
    ;(checkWhatsAppCloudApiConfiguration as jest.Mock).mockResolvedValue({ ok: true, code: null })

    const response = await GET(new Request("http://localhost/api/internal/whatsapp-preflight", {
      headers: { authorization: "Bearer cron-secret" },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, code: null })
  })

  it("reduce una falla a un codigo cerrado", async () => {
    process.env.CRON_SECRET = "cron-secret"
    ;(checkWhatsAppCloudApiConfiguration as jest.Mock).mockResolvedValue({
      ok: false,
      code: "provider_rejected",
    })

    const response = await GET(new Request("http://localhost/api/internal/whatsapp-preflight", {
      headers: { authorization: "Bearer cron-secret" },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, code: "provider_rejected" })
  })
})
