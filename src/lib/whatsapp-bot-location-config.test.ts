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
  isMedicalBoundaryMessage: jest.fn().mockReturnValue(false),
  containsSensitiveMedicalContent: jest.fn().mockReturnValue(false),
  EMERGENCY_REPLY: "guardia",
  MEDICAL_BOUNDARY_REPLY: "límite médico",
  SENSITIVE_MEDICAL_CONTENT_REPLY: "redacción clínica",
}))
jest.mock("@/lib/whatsapp-consent", () => ({
  CONSENT_TEXT: "consentimiento",
  CONSENT_ACCEPT_BUTTON_ID: "consent_accept",
  CONSENT_DECLINE_BUTTON_ID: "consent_decline",
  FOLLOWUP_CONSENT_TEXT: "seguimiento",
  FOLLOWUP_ACCEPT_BUTTON_ID: "followup_accept",
  FOLLOWUP_DECLINE_BUTTON_ID: "followup_decline",
  interpretConsentReply: jest.fn(),
  recordConsent: jest.fn(),
  recordAppointmentFollowupConsent: jest.fn(),
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
    bot_enabled: true,
    session_ttl_hours: 24,
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
import { sendList, sendText } from "@/lib/whatsapp"

const PHONE = "5491100000000"

function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "neq", "in", "lt", "update", "insert"]) {
    builder[method] = jest.fn(() => builder)
  }
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(locations: unknown, sessionOverrides: Record<string, unknown> = {}) {
  const session = {
    id: "session-1",
    phone: PHONE,
    wa_name: "Paciente",
    state: "derivado",
    obra_social: "Particular / sin cobertura",
    lead_id: "lead-1",
    last_inbound_at: new Date().toISOString(),
    entry_point: "organic",
    ctwa_clid: null,
    messages_sent_count: 4,
    referral_code: null,
    bot_paused: false,
    updated_at: new Date().toISOString(),
    ...sessionOverrides,
  }
  const lead = {
    id: "lead-1",
    preferred_location: "cimel_lanus",
    status: "derivado_cimel",
    requires_human: false,
  }
  const sessionsBuilder = makeThenableBuilder({ data: session, error: null })
  sessionsBuilder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  const leadsBuilder = makeThenableBuilder({ data: lead, error: null })
  const appConfigBuilder = makeThenableBuilder({ data: { value: locations }, error: null })

  ;(getServiceDb as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === "whatsapp_sessions") return sessionsBuilder
      if (table === "leads") return leadsBuilder
      if (table === "app_config") return appConfigBuilder
      throw new Error(`tabla inesperada: ${table}`)
    }),
  })
  return { sessionsBuilder, leadsBuilder }
}

beforeEach(() => jest.clearAllMocks())

describe("fuente única de sedes en el bot", () => {
  it("responde servicios exclusivamente desde `app_config.locations[].services` verificado", async () => {
    mockDb([{
      id: "cimel_lanus",
      name: "CIMEL Lanús",
      services: ["Servicio administrativo verificado"],
      verified_at: "2026-07-15T12:00:00.000Z",
      verified_by: "test-user",
      valid_from: "2026-07-01T00:00:00.000Z",
      active: true,
    }])

    await handleIncomingMessage({ phone: PHONE, text: "¿Qué prácticas realizan?" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Servicio administrativo verificado"),
      expect.anything()
    )
  })

  it("no afirma servicios de un seed legacy sin trazabilidad de verificación", async () => {
    mockDb([{
      id: "cimel_lanus",
      name: "CIMEL Lanús",
      services: ["Dato legacy no verificado"],
    }])

    await handleIncomingMessage({ phone: PHONE, text: "¿Qué prácticas realizan?" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("vigente y verificado"),
      expect.anything()
    )
    expect(sendText).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Dato legacy no verificado"),
      expect.anything()
    )
  })

  it("no avanza el estado antes de que el outbound quede aceptado", async () => {
    const locations = [{
      id: "cimel_lanus",
      name: "CIMEL Lanús",
      obras_sociales: ["OSDE"],
      services: [],
      verified_at: "2026-07-15T12:00:00.000Z",
      verified_by: "test-user",
      valid_from: "2026-07-01T00:00:00.000Z",
      active: true,
    }]
    const { sessionsBuilder } = mockDb(locations, {
      state: "esperando_sede",
      obra_social: null,
    })
    ;(sendList as jest.Mock).mockRejectedValueOnce(new Error("outbound accounting failed"))

    await expect(handleIncomingMessage({
      phone: PHONE,
      text: "CIMEL Lanús",
      messageType: "button_reply",
      buttonId: "cimel_lanus",
      waMessageId: "wamid.retry-state",
    })).rejects.toThrow()

    expect((sessionsBuilder.update as jest.Mock).mock.calls)
      .not.toContainEqual([expect.objectContaining({ state: "esperando_obra_social" })])

    ;(sendList as jest.Mock).mockResolvedValueOnce({})
    await handleIncomingMessage({
      phone: PHONE,
      text: "CIMEL Lanús",
      messageType: "button_reply",
      buttonId: "cimel_lanus",
      waMessageId: "wamid.retry-state",
    })
    expect(sessionsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: "esperando_obra_social" })
    )
  })
})
