// Incidente real 2026-07-15 (prueba de Sebastián): "Quiero atenderme particular" en una
// conversación ya en curso (estado "derivado") no matcheaba ninguna regla (consultar_cobertura
// exige la palabra "cobertura"/"obra social"/"prepaga" literal) y terminaba ofreciendo escalar a
// humano en vez de actualizar la obra social directamente.

jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp", () => ({
  sendText: jest.fn().mockResolvedValue({}),
  sendButtons: jest.fn().mockResolvedValue({}),
  sendList: jest.fn().mockResolvedValue({}),
}))
jest.mock("@/lib/whatsapp-intents", () => {
  const actual = jest.requireActual("@/lib/whatsapp-intents")
  return {
    ...actual,
    extractIntake: jest.fn(),
    classifyIntent: jest.fn().mockResolvedValue("otro_no_entendido"),
  }
})
jest.mock("@/lib/landing-referral-codes", () => ({
  extractReferralCode: jest.fn().mockReturnValue({ code: null }),
  findReferralCodeInfo: jest.fn().mockReturnValue(null),
}))
jest.mock("@/lib/medical-safety", () => ({
  isEmergencyMessage: jest.fn().mockReturnValue(false),
  EMERGENCY_REPLY: "Esto suena a una urgencia — llamá al 107 (SAME) o andá a la guardia más cercana.",
}))
jest.mock("@/lib/whatsapp-consent", () => ({
  CONSENT_TEXT: "texto de consentimiento",
  interpretConsentReply: jest.fn(),
  recordConsent: jest.fn(),
  hasConsented: jest.fn().mockResolvedValue(true),
}))
jest.mock("@/lib/whatsapp-handoff", () => ({
  buildHandoffSummary: jest.fn().mockReturnValue("resumen"),
  escalateToHuman: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/whatsapp-cost-tracking", () => ({
  logWhatsAppMessage: jest.fn().mockResolvedValue({ costEstimated: 0 }),
}))
jest.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppSettings: jest.fn().mockResolvedValue({
    cost_saving_mode: false,
    enable_service_message_charging: false,
    warning_message_threshold: 8,
    handoff_message_threshold: 12,
    monthly_cost_alert_ars: null,
    ai_provider: "gemini",
  }),
  isHighValueLead: jest.fn().mockReturnValue(false),
  shouldForceHandoff: jest.fn().mockReturnValue(false),
}))

import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { getServiceDb } from "@/lib/supabase/service"
import { sendText } from "@/lib/whatsapp"
import { classifyIntent } from "@/lib/whatsapp-intents"

const PHONE = "5491100000000"

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    phone: PHONE,
    wa_name: "Paciente",
    state: "derivado",
    obra_social: null,
    lead_id: "lead-1",
    last_inbound_at: new Date().toISOString(),
    entry_point: "organic",
    ctwa_clid: null,
    messages_sent_count: 5,
    referral_code: null,
    bot_paused: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = ["select", "eq", "neq", "in", "lt", "update", "insert"]
  for (const method of chain) builder[method] = jest.fn(() => builder)
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(session: ReturnType<typeof baseSession>) {
  const sessionsBuilder = makeThenableBuilder({ data: session, error: null })
  sessionsBuilder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  const leadsBuilder = makeThenableBuilder({ data: null, error: null })
  const appConfigBuilder = makeThenableBuilder({ data: { value: [] }, error: null })

  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") return sessionsBuilder
    if (table === "leads") return leadsBuilder
    if (table === "app_config") return appConfigBuilder
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
  return { leadsBuilder }
}

beforeEach(() => jest.clearAllMocks())

describe("declaración directa de 'particular' en estado derivado", () => {
  it('"Quiero atenderme particular" actualiza la obra social sin ofrecer escalar', async () => {
    const { leadsBuilder } = mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Quiero atenderme particular" })

    expect(leadsBuilder.update).toHaveBeenCalledWith({ insurance: "Particular / sin cobertura" })
    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Particular / sin cobertura"),
      expect.anything()
    )
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it('"Soy particular" también actualiza la obra social', async () => {
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Soy particular" })

    expect(classifyIntent).not.toHaveBeenCalled()
    const [, message] = (sendText as jest.Mock).mock.calls[0]
    expect(message).toContain("Particular / sin cobertura")
  })

  it('"No tengo obra social" también actualiza la obra social', async () => {
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "No tengo obra social" })

    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it('NO confunde "una duda particular" (adjetivo, no declaración de cobertura) -- sigue el camino normal', async () => {
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Tengo una duda particular sobre mi corazón" })

    expect(classifyIntent).toHaveBeenCalled()
  })
})
