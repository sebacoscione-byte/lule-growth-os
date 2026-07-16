jest.mock("@/lib/whatsapp-inbound-queue", () => ({
  drainWhatsAppInboundQueue: jest.fn(),
  claimWhatsAppDeadLetterAlerts: jest.fn(),
  finalizeWhatsAppDeadLetterAlert: jest.fn(),
}))
jest.mock("@/lib/alert-email", () => ({ sendCronFailureAlert: jest.fn() }))

import { POST } from "./route"
import {
  claimWhatsAppDeadLetterAlerts,
  drainWhatsAppInboundQueue,
  finalizeWhatsAppDeadLetterAlert,
} from "@/lib/whatsapp-inbound-queue"
import { sendCronFailureAlert } from "@/lib/alert-email"

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  ;(claimWhatsAppDeadLetterAlerts as jest.Mock).mockResolvedValue({
    claimToken: "11111111-1111-4111-8111-111111111111",
    eventCount: 0,
  })
  ;(finalizeWhatsAppDeadLetterAlert as jest.Mock).mockResolvedValue(undefined)
  ;(sendCronFailureAlert as jest.Mock).mockResolvedValue(true)
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("POST /api/internal/whatsapp-worker", () => {
  it("falla cerrado cuando CRON_SECRET no está configurado", async () => {
    delete process.env.CRON_SECRET
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", { method: "POST" }))
    expect(response.status).toBe(401)
    expect(drainWhatsAppInboundQueue).not.toHaveBeenCalled()
  })

  it("rechaza credenciales incorrectas", async () => {
    process.env.CRON_SECRET = "worker-secret"
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer incorrecto" },
    }))
    expect(response.status).toBe(401)
  })

  it("drena la cola con autorización válida", async () => {
    process.env.CRON_SECRET = "worker-secret"
    ;(drainWhatsAppInboundQueue as jest.Mock).mockResolvedValue({
      claimed: 2, processed: 1, retried: 1, deadLettered: 0,
    })
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claimed: 2, processed: 1, retried: 1, deadLettered: 0 })
    expect(drainWhatsAppInboundQueue).toHaveBeenCalledWith({ maxEvents: 50, timeBudgetMs: 40_000 })
  })

  it("alerta una DLQ nueva sin incluir contenido del paciente", async () => {
    process.env.CRON_SECRET = "worker-secret"
    ;(drainWhatsAppInboundQueue as jest.Mock).mockResolvedValue({
      claimed: 1, processed: 0, retried: 0, deadLettered: 1,
    })
    ;(claimWhatsAppDeadLetterAlerts as jest.Mock).mockResolvedValue({
      claimToken: "11111111-1111-4111-8111-111111111111",
      eventCount: 1,
    })
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }))
    expect(response.status).toBe(200)
    expect(sendCronFailureAlert).toHaveBeenCalledWith(
      "whatsapp-worker",
      "Cola WhatsApp: 1 evento(s) nuevo(s) en dead-letter."
    )
    expect(finalizeWhatsAppDeadLetterAlert).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      true
    )
  })

  it("una falla de alertas no cambia el resultado exitoso del worker", async () => {
    process.env.CRON_SECRET = "worker-secret"
    ;(drainWhatsAppInboundQueue as jest.Mock).mockResolvedValue({
      claimed: 1, processed: 0, retried: 0, deadLettered: 1,
    })
    ;(claimWhatsAppDeadLetterAlerts as jest.Mock).mockResolvedValue({
      claimToken: "11111111-1111-4111-8111-111111111111",
      eventCount: 1,
    })
    ;(sendCronFailureAlert as jest.Mock).mockRejectedValue(new Error("provider detail"))
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }))
    expect(response.status).toBe(200)
    expect(finalizeWhatsAppDeadLetterAlert).not.toHaveBeenCalled()
  })

  it("libera la reserva si el proveedor no confirma el email", async () => {
    process.env.CRON_SECRET = "worker-secret"
    ;(drainWhatsAppInboundQueue as jest.Mock).mockResolvedValue({
      claimed: 1, processed: 0, retried: 0, deadLettered: 1,
    })
    ;(claimWhatsAppDeadLetterAlerts as jest.Mock).mockResolvedValue({
      claimToken: "11111111-1111-4111-8111-111111111111",
      eventCount: 1,
    })
    ;(sendCronFailureAlert as jest.Mock).mockResolvedValue(false)
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }))
    expect(response.status).toBe(200)
    expect(finalizeWhatsAppDeadLetterAlert).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      false
    )
  })

  it("no expone el detalle de una falla interna", async () => {
    process.env.CRON_SECRET = "worker-secret"
    ;(drainWhatsAppInboundQueue as jest.Mock).mockRejectedValue(new Error("secret database detail"))
    const response = await POST(new Request("http://localhost/api/internal/whatsapp-worker", {
      method: "POST",
      headers: { authorization: "Bearer worker-secret" },
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "worker_unavailable" })
  })
})
