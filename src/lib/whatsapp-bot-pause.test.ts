// Cubre el flag `bot_paused` (nuevo): cuando el equipo responde a mano desde el Inbox, el bot
// tiene que dejar de contestarle a ese paciente hasta que alguien lo reactive — sin que eso afecte
// los guardrails de seguridad (emergencia médica, baja de contacto), que tienen que seguir andando
// pase lo que pase. No se testea el resto del flujo del bot acá (no hay suite integral todavía).

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
import { sendText } from "@/lib/whatsapp"
import { escalateToHuman } from "@/lib/whatsapp-handoff"
import { isEmergencyMessage } from "@/lib/medical-safety"
import { isMarketingOptOutMessage } from "@/lib/whatsapp-intents"

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
    messages_sent_count: 3,
    referral_code: null,
    bot_paused: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

/** Query builder mínimo que soporta tanto `.single()/.maybeSingle()` como awaitearse directo
 * (para las consultas de closeOtherStaleSessions/updateSession, que no piden una fila puntual). */
function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = ["select", "eq", "neq", "in", "lt", "update", "insert"]
  for (const method of chain) builder[method] = jest.fn(() => builder)
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(opts: { session: ReturnType<typeof baseSession>; lead?: Record<string, unknown> | null }) {
  const sessionsBuilder = makeThenableBuilder({ data: opts.session, error: null })
  // closeOtherStaleSessions espera un array (ninguna otra sesión stale en estos tests).
  sessionsBuilder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  const leadsBuilder = makeThenableBuilder({ data: opts.lead ?? null, error: null })
  // getLocations() (usada por el FAQ/instrucciones de sede) lee `app_config.locations` — vacío alcanza acá.
  const appConfigBuilder = makeThenableBuilder({ data: { value: [] }, error: null })

  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") return sessionsBuilder
    if (table === "leads") return leadsBuilder
    if (table === "app_config") return appConfigBuilder
    throw new Error(`tabla inesperada en el mock: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isEmergencyMessage as jest.Mock).mockReturnValue(false)
  ;(isMarketingOptOutMessage as jest.Mock).mockReturnValue(false)
})

describe("handleIncomingMessage — bot_paused", () => {
  it("con el bot pausado, un mensaje normal no dispara ninguna respuesta automática", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })

    await handleIncomingMessage({ phone: PHONE, text: "hola, quería preguntar algo" })

    expect(sendText).not.toHaveBeenCalled()
    expect(escalateToHuman).not.toHaveBeenCalled()
  })

  it("sin pausa, el mismo mensaje sí dispara la respuesta normal del bot (control)", async () => {
    mockDb({ session: baseSession({ bot_paused: false }) })

    await handleIncomingMessage({ phone: PHONE, text: "hola, quería preguntar algo" })

    expect(sendText).toHaveBeenCalled()
  })

  it("con el bot pausado, una emergencia médica se escala igual (guardrail siempre activo)", async () => {
    mockDb({ session: baseSession({ bot_paused: true }), lead: { id: "lead-1" } })
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: "tengo un dolor fuerte en el pecho" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("107"),
      expect.objectContaining({ flowIntent: "urgencia_medica" })
    )
    expect(escalateToHuman).toHaveBeenCalled()
  })

  it("con el bot pausado, una baja de contacto (BAJA/STOP) se procesa igual", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })
    ;(isMarketingOptOutMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: "BAJA" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("no te vamos a volver a escribir"),
      expect.objectContaining({ flowIntent: "baja_contacto" })
    )
  })
})
