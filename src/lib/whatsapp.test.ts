jest.mock("./whatsapp-cost-tracking", () => ({
  logWhatsAppMessage: jest.fn().mockResolvedValue({ costEstimated: 0 }),
  incrementMessagesSentCount: jest.fn().mockResolvedValue(1),
}))

jest.mock("./whatsapp-templates", () => ({
  getApprovedTemplate: jest.fn(),
  fillTemplateBody: jest.fn().mockReturnValue("cuerpo del template"),
}))

import { sendText, sendTemplate, WindowClosedError, TemplateNotApprovedError, type SendContext } from "@/lib/whatsapp"
import { getApprovedTemplate } from "./whatsapp-templates"

const baseCtx: SendContext = {
  windowState: "open",
  entryPoint: "organic",
  serviceMessageChargingEnabled: false,
}

describe("sendText — gate de ventana de 24h", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123"
    process.env.WHATSAPP_ACCESS_TOKEN = "token"
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
  })

  it("con la ventana abierta envia el mensaje de texto libre normalmente", async () => {
    await sendText("5491100000000", "hola", baseCtx)
    expect(global.fetch).toHaveBeenCalledTimes(1)
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
