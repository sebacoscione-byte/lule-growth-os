// Ola 4 (incidente real 2026-07-14): el paciente escribió "gracias doc, ya conseguí turno en el
// [otro lugar]" para cerrar la conversación -- el bot lo tomó como un pedido de turno nuevo (por
// la palabra "turno") y le reenvió el menú de sedes, ignorando que ya no necesitaba nada.

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
    classifyIntent: jest.fn(),
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
    ai_provider: "sin_ia",
  }),
  isHighValueLead: jest.fn().mockReturnValue(false),
  shouldForceHandoff: jest.fn().mockReturnValue(false),
}))

import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { getServiceDb } from "@/lib/supabase/service"
import { sendText, sendButtons } from "@/lib/whatsapp"
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
}

beforeEach(() => jest.clearAllMocks())

describe("turno_ya_resuelto: el paciente cierra porque ya consiguió turno en otro lado", () => {
  it("responde con un cierre cálido, sin reenviar el menú de sedes", async () => {
    ;(classifyIntent as jest.Mock).mockResolvedValue("turno_ya_resuelto")
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "gracias doc, ya conseguí turno en el guemes" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Qué bueno"),
      expect.objectContaining({ flowIntent: "turno_ya_resuelto" })
    )
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it("un pedido de turno normal (sin cerrar) sigue mostrando el menú de sedes como antes", async () => {
    ;(classifyIntent as jest.Mock).mockResolvedValue("pedir_turno")
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "quiero sacar un turno" })

    expect(sendButtons).toHaveBeenCalled()
  })
})
