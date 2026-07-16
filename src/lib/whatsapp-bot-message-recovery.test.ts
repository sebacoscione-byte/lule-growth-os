// Ola 4 (incidente real 2026-07-14, David Portas): logWhatsAppMessage() solo inserta en `messages`
// si ya hay lead_id (esa columna es NOT NULL) -- el primer mensaje con contenido real de cada
// conversación nueva se logueaba ANTES de que el lead existiera, así que se perdía para siempre
// aunque el lead sí se creara (invisible en el Inbox). El intake administrativo aceptado conserva
// una copia canónica; una urgencia solo conserva flags operativos, nunca síntomas libres.

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
  INTENT_REPLIES: { otro_no_entendido: "No entendí bien, ¿podés reformular?" },
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
import { extractIntake } from "@/lib/whatsapp-intents"
import { isEmergencyMessage } from "@/lib/medical-safety"

const PHONE = "5491100000000"
const NEW_LEAD_ID = "lead-nuevo-1"

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    phone: PHONE,
    wa_name: "Paciente",
    state: "intake_pendiente",
    obra_social: null,
    lead_id: null,
    last_inbound_at: new Date().toISOString(),
    entry_point: "organic",
    ctwa_clid: null,
    messages_sent_count: 0,
    referral_code: null,
    bot_paused: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = ["select", "eq", "neq", "in", "lt", "update", "insert", "upsert", "is"]
  for (const method of chain) builder[method] = jest.fn(() => builder)
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(session: ReturnType<typeof baseSession>) {
  const sessionsBuilder = makeThenableBuilder({ data: session, error: null })
  sessionsBuilder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  // Sirve tanto para el insert que crea el lead (necesita .id) como para un getLead() posterior
  // (necesita el resto de los campos) -- mismo objeto compartido, alcanza para estos tests.
  const leadsBuilder = makeThenableBuilder({
    data: { id: NEW_LEAD_ID, name: null, insurance: null, patient_age: null, general_reason: null, possible_emergency: false, protocol_interest: false, protocol_name: null, last_message: null },
    error: null,
  })
  const appConfigBuilder = makeThenableBuilder({ data: { value: [] }, error: null })
  const messagesBuilder = makeThenableBuilder({ data: null, error: null })
  const consentBuilder = makeThenableBuilder({ data: null, error: null })
  const costBuilder = makeThenableBuilder({ data: null, error: null })

  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") return sessionsBuilder
    if (table === "leads") return leadsBuilder
    if (table === "app_config") return appConfigBuilder
    if (table === "messages") return messagesBuilder
    if (table === "consent_records") return consentBuilder
    if (table === "whatsapp_cost_events") return costBuilder
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  const rpc = jest.fn().mockImplementation((name: string) => {
    if (name === "upsert_whatsapp_intake_lead" || name === "ensure_whatsapp_lead") {
      return Promise.resolve({ data: session.lead_id ?? NEW_LEAD_ID, error: null })
    }
    throw new Error(`rpc inesperada en el mock: ${name}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy, rpc })
  return { leadsBuilder, messagesBuilder, rpc }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isEmergencyMessage as jest.Mock).mockReturnValue(false)
})

describe("recuperación del mensaje que crea el lead", () => {
  it("intake normal: recupera el mensaje dentro de la RPC atómica", async () => {
    const texto = "Busco turno cardiologico para un familiar, necesita que lo vean pronto"
    const { messagesBuilder, rpc } = mockDb(baseSession({ state: "intake_pendiente", lead_id: null }))
    ;(extractIntake as jest.Mock).mockReturnValue({ motivo: null, obraSocial: null, sede: null })

    await handleIncomingMessage({ phone: PHONE, text: texto, waMessageId: "wamid.intake-normal" })

    expect(rpc).toHaveBeenCalledWith("upsert_whatsapp_intake_lead", expect.objectContaining({
      p_phone: PHONE,
      p_raw_message: texto,
      p_wa_message_id: "wamid.intake-normal",
    }))
    expect(messagesBuilder.insert).not.toHaveBeenCalled()
  })

  it("intake para un lead que ya existía: no vuelve a insertar el mensaje en `messages` (ya lo logueó logWhatsAppMessage)", async () => {
    const { messagesBuilder, rpc } = mockDb(baseSession({ state: "intake_pendiente", lead_id: "lead-existente" }))
    ;(extractIntake as jest.Mock).mockReturnValue({ motivo: null, obraSocial: "OSDE", sede: null })

    await handleIncomingMessage({ phone: PHONE, text: "tengo OSDE" })

    expect(messagesBuilder.insert).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("upsert_whatsapp_intake_lead", expect.any(Object))
  })

  it("un retry del mismo wa_message_id recupera el mensaje con upsert idempotente", async () => {
    const texto = "Quiero un turno con OSDE"
    const { messagesBuilder, rpc } = mockDb(baseSession({ state: "intake_pendiente", lead_id: null }))
    ;(extractIntake as jest.Mock).mockReturnValue({ motivo: "turno", obraSocial: "OSDE", sede: null })

    await handleIncomingMessage({ phone: PHONE, text: texto, waMessageId: "wamid.intake-1" })

    expect(rpc).toHaveBeenCalledWith("upsert_whatsapp_intake_lead", expect.objectContaining({
      p_raw_message: texto,
      p_wa_message_id: "wamid.intake-1",
    }))
    expect(messagesBuilder.upsert).not.toHaveBeenCalled()
  })

  it("emergencia médica con lead nuevo: guarda flags pero no persiste el texto con síntomas", async () => {
    const texto = "tengo mucho dolor de pecho y no puedo respirar"
    const { leadsBuilder, messagesBuilder, rpc } = mockDb(baseSession({ state: "nuevo", lead_id: null }))
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: texto })

    expect(messagesBuilder.insert).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("ensure_whatsapp_lead", expect.objectContaining({
      p_possible_emergency: true,
      p_requires_human: true,
      p_status: "urgencia_derivada",
    }))
    expect(leadsBuilder.insert).not.toHaveBeenCalled()
  })

  it("emergencia médica con lead ya existente: no inserta de nuevo (solo actualiza el lead)", async () => {
    const { messagesBuilder, leadsBuilder, rpc } = mockDb(baseSession({ state: "derivado", lead_id: "lead-existente" }))
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: "tengo dolor de pecho" })

    expect(messagesBuilder.insert).not.toHaveBeenCalled()
    expect(leadsBuilder.update).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("ensure_whatsapp_lead", expect.objectContaining({
      p_status: "urgencia_derivada",
      p_possible_emergency: true,
    }))
  })
})
