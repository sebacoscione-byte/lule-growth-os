jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }))

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { classifyMessage, classifyWhatsAppIntent } from "@/lib/ai"

const ORIGINAL_ENV = {
  NEXT_PUBLIC_AI_MODE: process.env.NEXT_PUBLIC_AI_MODE,
  AI_PROVIDER: process.env.AI_PROVIDER,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  DAILY_AI_REQUEST_LIMIT: process.env.DAILY_AI_REQUEST_LIMIT,
}

function restoreEnv(name: keyof typeof ORIGINAL_ENV) {
  const value = ORIGINAL_ENV[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe("clasificador de WhatsApp sin caché de datos de pacientes", () => {
  const insertRequest = jest.fn().mockResolvedValue({ error: null })
  const from = jest.fn((table: string) => {
    if (table !== "ai_requests") throw new Error(`tabla no permitida en este flujo: ${table}`)

    const builder: Record<string, jest.Mock> = {}
    builder.select = jest.fn(() => builder)
    builder.gte = jest.fn(() => builder)
    builder.eq = jest.fn().mockResolvedValue({ count: 0, error: null })
    builder.insert = insertRequest
    return builder
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NEXT_PUBLIC_AI_MODE = "gemini_api"
    process.env.AI_PROVIDER = "gemini"
    process.env.GEMINI_API_KEY = "test-only-key"
    process.env.DAILY_AI_REQUEST_LIMIT = "20"
    ;(createSupabaseClient as jest.Mock).mockReturnValue({ from })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    restoreEnv("NEXT_PUBLIC_AI_MODE")
    restoreEnv("AI_PROVIDER")
    restoreEnv("GEMINI_API_KEY")
    restoreEnv("DAILY_AI_REQUEST_LIMIT")
  })

  it("clasifica un enum sin leer ni escribir ai_outputs", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"intent":"pedir_turno"}' }] } }] }),
    } as Response)

    await expect(classifyWhatsAppIntent("Quiero pedir turno")).resolves.toBe("pedir_turno")
    expect(from).toHaveBeenCalledWith("ai_requests")
    expect(from).not.toHaveBeenCalledWith("ai_outputs")
  })

  it("rechaza una salida de WhatsApp que intente agregar texto libre", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        intent: "pedir_turno",
        reply: "respuesta médica no autorizada",
      }) }] } }] }),
    } as Response)

    await expect(classifyWhatsAppIntent("Quiero pedir turno")).rejects.toThrow()
    expect(from).not.toHaveBeenCalledWith("ai_outputs")
  })

  it("clasifica un lead sin persistir el prompt ni aceptar campos fuera del contrato", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        intent: "turno",
        requested_service: "consulta_cardiologia",
        suggested_location: "cimel_lanus",
        suggested_day: "martes",
        priority_score: 3,
        requires_human: false,
        possible_emergency: false,
        next_action: "derivar_cimel",
        injected_reply: "texto libre que debe descartarse",
      }) }] } }] }),
    } as Response)

    const result = await classifyMessage("Quiero turno en Lanús")
    expect(result.reply_suggestion).toBe("Gracias por escribirnos. Podemos orientarte sobre sedes y canales oficiales para pedir turno.")
    expect(result).not.toHaveProperty("injected_reply")
    expect(from).not.toHaveBeenCalledWith("ai_outputs")
  })

  it("normaliza como urgencia un JSON contradictorio del modelo", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        intent: "urgencia",
        requested_service: "no_definido",
        suggested_location: "preguntar",
        suggested_day: "preguntar",
        priority_score: 1,
        requires_human: false,
        possible_emergency: false,
        next_action: "responder",
      }) }] } }] }),
    } as Response)

    const result = await classifyMessage("situación no cubierta por las reglas locales")
    expect(result).toEqual(expect.objectContaining({
      intent: "urgencia",
      priority_score: 9,
      requires_human: true,
      possible_emergency: true,
      next_action: "escalar",
    }))
    expect(from).not.toHaveBeenCalledWith("ai_outputs")
  })

  it("sanitiza el error persistido aunque el proveedor devuelva contexto sensible", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "eco de contexto sensible del paciente" } }),
    } as Response)

    await expect(classifyWhatsAppIntent("mensaje clínico privado")).rejects.toThrow()
    expect(insertRequest).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "whatsapp_intent",
      success: false,
      error_message: "patient_context_request_failed",
    }))
    expect(JSON.stringify(insertRequest.mock.calls)).not.toContain("contexto sensible")
    expect(from).not.toHaveBeenCalledWith("ai_outputs")
  })
})
