// Incidente real 2026-07-15 (prueba de Sebastián): un "Hola" simple de alguien que ya tiene una
// conversación en curso (estado "derivado") se clasificaba como "otro_no_entendido" y el bot
// respondía "no entendí tu consulta" ofreciendo escalar a un humano -- para un saludo de alguien
// que ya está en la conversación corresponde la bienvenida de vuelta, no un aviso de fallo.

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
import { sendButtons } from "@/lib/whatsapp"
import { classifyIntent } from "@/lib/whatsapp-intents"

const PHONE = "5491100000000"

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    phone: PHONE,
    wa_name: "Paciente",
    state: "derivado",
    obra_social: "Osde 410",
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
  const appConfigBuilder = makeThenableBuilder({
    data: {
      value: [{
        id: "cimel_lanus",
        name: "CIMEL Lanús",
        services: ["Consulta cardiológica", "Ecocardiograma"],
        verified_at: "2026-07-15T12:00:00.000Z",
        verified_by: "test-user",
        valid_from: "2026-07-01T00:00:00.000Z",
        active: true,
      }],
    },
    error: null,
  })

  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") return sessionsBuilder
    if (table === "leads") return leadsBuilder
    if (table === "app_config") return appConfigBuilder
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
}

beforeEach(() => jest.clearAllMocks())

describe("saludo simple en estado derivado", () => {
  it('"Hola" solo devuelve la bienvenida de vuelta, sin clasificar ni ofrecer escalar', async () => {
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Hola" })

    expect(classifyIntent).not.toHaveBeenCalled() // determinístico y gratis, no gasta IA
    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("¡Hola!"),
      expect.arrayContaining([expect.objectContaining({ id: "cimel_lanus" })]),
      expect.anything()
    )
    const [, message] = (sendButtons as jest.Mock).mock.calls[0]
    expect(message).not.toContain("No estoy seguro")
  })

  it('"Buenas tardes" también cuenta como saludo simple', async () => {
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Buenas tardes" })

    expect(classifyIntent).not.toHaveBeenCalled()
    const [, message] = (sendButtons as jest.Mock).mock.calls[0]
    expect(message).not.toContain("No estoy seguro")
  })

  it('"Hola, quiero un turno" NO es un saludo simple -- sigue el camino normal de clasificación', async () => {
    ;(classifyIntent as jest.Mock).mockResolvedValue("pedir_turno")
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "Hola, quiero un turno" })

    expect(classifyIntent).toHaveBeenCalled()
  })

  it("un mensaje realmente incomprensible sigue ofreciendo escalar a humano (no se rompió el caso genuino)", async () => {
    ;(classifyIntent as jest.Mock).mockResolvedValue("otro_no_entendido")
    mockDb(baseSession())

    await handleIncomingMessage({ phone: PHONE, text: "asdkjaslkdj qwe 123" })

    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("No estoy seguro"),
      [{ id: "hablar_humano", title: "Hablar con humano" }],
      expect.anything()
    )
  })
})
