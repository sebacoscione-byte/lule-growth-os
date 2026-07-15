// Ola 4 (incidente real 2026-07-14, David Portas): logWhatsAppMessage() solo inserta en `messages`
// si ya hay lead_id (esa columna es NOT NULL) -- el primer mensaje con contenido real de cada
// conversación nueva se logueaba ANTES de que el lead existiera, así que se perdía para siempre
// aunque el lead sí se creara (invisible en el Inbox). Cubre los dos puntos donde
// handleIncomingMessage crea un lead nuevo: el intake normal y una emergencia médica.

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
  // Sirve tanto para el insert que crea el lead (necesita .id) como para un getLead() posterior
  // (necesita el resto de los campos) -- mismo objeto compartido, alcanza para estos tests.
  const leadsBuilder = makeThenableBuilder({
    data: { id: NEW_LEAD_ID, name: null, insurance: null, patient_age: null, general_reason: null, possible_emergency: false, protocol_interest: false, protocol_name: null, last_message: null },
    error: null,
  })
  const appConfigBuilder = makeThenableBuilder({ data: { value: [] }, error: null })
  const messagesBuilder = makeThenableBuilder({ data: null, error: null })

  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") return sessionsBuilder
    if (table === "leads") return leadsBuilder
    if (table === "app_config") return appConfigBuilder
    if (table === "messages") return messagesBuilder
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
  return { leadsBuilder, messagesBuilder }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isEmergencyMessage as jest.Mock).mockReturnValue(false)
})

describe("recuperación del mensaje que crea el lead", () => {
  it("intake normal: al crear el lead, inserta en `messages` el texto que lo originó", async () => {
    const texto = "Busco turno cardiologico para un familiar, necesita que lo vean pronto"
    const { messagesBuilder } = mockDb(baseSession({ state: "intake_pendiente", lead_id: null }))
    ;(extractIntake as jest.Mock).mockReturnValue({ motivo: null, obraSocial: null, edad: null, sede: null, notas: texto })

    await handleIncomingMessage({ phone: PHONE, text: texto })

    expect(messagesBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: NEW_LEAD_ID, role: "user", content: texto, direction: "inbound" })
    )
  })

  it("intake para un lead que ya existía: no vuelve a insertar el mensaje en `messages` (ya lo logueó logWhatsAppMessage)", async () => {
    const { messagesBuilder } = mockDb(baseSession({ state: "intake_pendiente", lead_id: "lead-existente" }))
    ;(extractIntake as jest.Mock).mockReturnValue({ motivo: null, obraSocial: "OSDE", edad: null, sede: null, notas: "tengo OSDE" })

    await handleIncomingMessage({ phone: PHONE, text: "tengo OSDE" })

    expect(messagesBuilder.insert).not.toHaveBeenCalled()
  })

  it("emergencia médica con lead nuevo: inserta en `messages` el texto con los síntomas", async () => {
    const texto = "tengo mucho dolor de pecho y no puedo respirar"
    const { messagesBuilder } = mockDb(baseSession({ state: "nuevo", lead_id: null }))
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: texto })

    expect(messagesBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: NEW_LEAD_ID, role: "user", content: texto, direction: "inbound" })
    )
  })

  it("emergencia médica con lead ya existente: no inserta de nuevo (solo actualiza el lead)", async () => {
    const { messagesBuilder, leadsBuilder } = mockDb(baseSession({ state: "derivado", lead_id: "lead-existente" }))
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: "tengo dolor de pecho" })

    expect(messagesBuilder.insert).not.toHaveBeenCalled()
    expect(leadsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "urgencia_derivada", possible_emergency: true })
    )
  })
})
