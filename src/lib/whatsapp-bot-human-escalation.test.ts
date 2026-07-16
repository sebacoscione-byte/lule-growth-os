// Ola 4 (incidente real 2026-07-14): el botón "Hablar con humano" ante "otro_no_entendido" antes
// solo se ofrecía en cost_saving_mode -- fuera de ese modo (el default de la cuenta), el paciente
// tenía que escribir la frase exacta para escalar, y eso le costó varios intentos en el incidente
// real. Cubre que el botón se ofrece siempre, con o sin cost_saving_mode.

jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp", () => ({
  sendText: jest.fn().mockResolvedValue({}),
  sendButtons: jest.fn().mockResolvedValue({}),
  sendList: jest.fn().mockResolvedValue({}),
}))
jest.mock("@/lib/whatsapp-intents", () => ({
  extractIntake: jest.fn(),
  classifyIntent: jest.fn().mockResolvedValue("otro_no_entendido"),
  classifyProtocolButtonReply: jest.fn().mockReturnValue(null),
  isMarketingOptOutMessage: jest.fn().mockReturnValue(false),
  INTENT_REPLIES: { otro_no_entendido: "No estoy seguro de haber entendido tu consulta. ¿Podés reformularla o preferís hablar con una persona del equipo?" },
}))
jest.mock("@/lib/landing-referral-codes", () => ({
  extractReferralCode: jest.fn().mockReturnValue({ code: null }),
  findReferralCodeInfo: jest.fn().mockReturnValue(null),
}))
jest.mock("@/lib/medical-safety", () => ({
  isEmergencyMessage: jest.fn().mockReturnValue(false),
  isMedicalBoundaryMessage: jest.fn().mockReturnValue(false),
  containsSensitiveMedicalContent: jest.fn().mockReturnValue(false),
  EMERGENCY_REPLY: "Esto suena a una urgencia — llamá al 107 (SAME) o andá a la guardia más cercana.",
  MEDICAL_BOUNDARY_REPLY: "Este canal es solo administrativo.",
  SENSITIVE_MEDICAL_CONTENT_REPLY: "Repetí sólo los datos administrativos.",
}))
jest.mock("@/lib/whatsapp-consent", () => ({
  CONSENT_TEXT: "texto de consentimiento",
  CONSENT_ACCEPT_BUTTON_ID: "consent_accept",
  CONSENT_DECLINE_BUTTON_ID: "consent_decline",
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
  getWhatsAppSettings: jest.fn(),
  isHighValueLead: jest.fn().mockReturnValue(false),
  shouldForceHandoff: jest.fn().mockReturnValue(false),
}))

import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import { getServiceDb } from "@/lib/supabase/service"
import { sendButtons } from "@/lib/whatsapp"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"

const PHONE = "5491100000000"

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    cost_saving_mode: false,
    enable_service_message_charging: false,
    warning_message_threshold: 8,
    handoff_message_threshold: 12,
    monthly_cost_alert_ars: null,
    ai_provider: "sin_ia",
    ...overrides,
  }
}

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
    messages_sent_count: 3,
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

describe("otro_no_entendido: botón de escalar a humano", () => {
  it("lo ofrece con cost_saving_mode apagado (default de la cuenta)", async () => {
    ;(getWhatsAppSettings as jest.Mock).mockResolvedValue(baseSettings({ cost_saving_mode: false }))
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "xyz esto no tiene sentido para mi" })

    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.any(String),
      [{ id: "hablar_humano", title: "Hablar con humano" }],
      expect.objectContaining({ flowIntent: "otro_no_entendido" })
    )
  })

  it("lo sigue ofreciendo con cost_saving_mode prendido", async () => {
    ;(getWhatsAppSettings as jest.Mock).mockResolvedValue(baseSettings({ cost_saving_mode: true }))
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "xyz esto no tiene sentido para mi" })

    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.any(String),
      [{ id: "hablar_humano", title: "Hablar con humano" }],
      expect.objectContaining({ flowIntent: "otro_no_entendido" })
    )
  })
})
