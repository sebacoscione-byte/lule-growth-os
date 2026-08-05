jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp", () => ({
  sendText: jest.fn().mockResolvedValue({}),
  sendButtons: jest.fn().mockResolvedValue({}),
  sendList: jest.fn().mockResolvedValue({}),
}))
jest.mock("@/lib/whatsapp-intents", () => ({
  extractIntake: jest.fn(),
  classifyIntent: jest.fn(),
  classifyProtocolButtonReply: jest.fn().mockReturnValue(null),
  isMarketingOptOutMessage: jest.fn().mockReturnValue(false),
  INTENT_REPLIES: {},
}))
jest.mock("@/lib/landing-referral-codes", () => ({
  extractReferralCode: jest.fn().mockReturnValue({ code: null, contentItemId: null }),
  findReferralCodeInfo: jest.fn().mockReturnValue(null),
}))
jest.mock("@/lib/medical-safety", () => ({
  isEmergencyMessage: jest.fn().mockReturnValue(false),
  isMedicalBoundaryMessage: jest.fn().mockReturnValue(false),
  containsSensitiveMedicalContent: jest.fn().mockReturnValue(false),
  EMERGENCY_REPLY: "respuesta fija de guardia",
  MEDICAL_BOUNDARY_REPLY: "respuesta fija de límite médico",
  SENSITIVE_MEDICAL_CONTENT_REPLY: "respuesta fija de redacción clínica",
}))
jest.mock("@/lib/whatsapp-consent", () => {
  const actual = jest.requireActual("@/lib/whatsapp-consent")
  return {
    ...actual,
    hasConsented: jest.fn(),
    recordConsent: jest.fn().mockResolvedValue(undefined),
  }
})
jest.mock("@/lib/whatsapp-handoff", () => ({
  buildHandoffSummary: jest.fn(),
  escalateToHuman: jest.fn(),
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
import { sendButtons, sendText } from "@/lib/whatsapp"
import { classifyIntent, extractIntake } from "@/lib/whatsapp-intents"
import { containsSensitiveMedicalContent, isMedicalBoundaryMessage } from "@/lib/medical-safety"
import { logWhatsAppMessage } from "@/lib/whatsapp-cost-tracking"
import { extractReferralCode, findReferralCodeInfo } from "@/lib/landing-referral-codes"
import {
  CONSENT_ACCEPT_BUTTON_ID,
  hasConsented,
  recordConsent,
} from "@/lib/whatsapp-consent"

const PHONE = "5491100000000"

function baseSession(state: "nuevo" | "esperando_consentimiento" | "derivado", leadId: string | null = null) {
  return {
    id: "session-1",
    phone: PHONE,
    wa_name: "Paciente",
    state,
    obra_social: null,
    lead_id: leadId,
    last_inbound_at: new Date().toISOString(),
    entry_point: "organic",
    ctwa_clid: null,
    messages_sent_count: 0,
    referral_code: null,
    content_item_id: null,
    content_origin_location_key: null,
    content_attributed_at: null,
    bot_paused: false,
    updated_at: new Date().toISOString(),
  }
}

function makeSessionBuilder(session: ReturnType<typeof baseSession>) {
  const builder: Record<string, jest.Mock | ((resolve: (value: unknown) => unknown) => unknown)> = {}
  for (const method of ["select", "eq", "neq", "in", "lt", "update", "insert"]) {
    builder[method] = jest.fn(() => builder)
  }
  builder.single = jest.fn().mockResolvedValue({ data: session, error: null })
  builder.maybeSingle = jest.fn().mockResolvedValue({ data: session, error: null })
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  return builder
}

function mockSession(session: ReturnType<typeof baseSession>) {
  const sessions = makeSessionBuilder(session)
  const leads = makeSessionBuilder(session)
  leads.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
  const appConfig = makeSessionBuilder(session)
  appConfig.single = jest.fn().mockResolvedValue({ data: { value: [] }, error: null })
  ;(getServiceDb as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === "whatsapp_sessions") return sessions
      if (table === "leads") return leads
      if (table === "app_config") return appConfig
      throw new Error(`tabla inesperada: ${table}`)
    }),
  })
  return sessions
}

beforeEach(() => jest.clearAllMocks())

describe("consentimiento explícito antes del intake", () => {
  it("preserva pieza y sede como metadata opaca antes del consentimiento", async () => {
    const sessions = mockSession(baseSession("nuevo"))
    ;(hasConsented as jest.Mock).mockResolvedValue(false)
    ;(extractReferralCode as jest.Mock).mockReturnValueOnce({
      code: "LAN-GRAL-01",
      contentItemId: "content_20260804_abc",
    })
    ;(findReferralCodeInfo as jest.Mock).mockReturnValueOnce({ locationKey: "cimel" })

    await handleIncomingMessage({
      phone: PHONE,
      text: "Hola\n\nRef: LAN-GRAL-01\nContenido: content_20260804_abc",
      waMessageId: "wamid.attribution-1",
    })

    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({
      state: "esperando_consentimiento",
      referral_code: "LAN-GRAL-01",
      content_item_id: "content_20260804_abc",
      content_origin_location_key: "cimel",
      content_attributed_at: expect.any(String),
    }))
  })

  it("ignora una pieza si el mensaje no trae una referencia interna conocida", async () => {
    const sessions = mockSession(baseSession("nuevo"))
    ;(hasConsented as jest.Mock).mockResolvedValue(false)
    ;(extractReferralCode as jest.Mock).mockReturnValueOnce({
      code: "XXX-FAKE-99",
      contentItemId: "content_inventado",
    })
    ;(findReferralCodeInfo as jest.Mock).mockReturnValueOnce(null)

    await handleIncomingMessage({ phone: PHONE, text: "mensaje editado", waMessageId: "wamid.attribution-unknown" })

    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({
      referral_code: null,
      content_item_id: null,
      content_origin_location_key: null,
      content_attributed_at: null,
    }))
  })


  it("un mensaje inicial con datos solo recibe el aviso y botones; no se interpreta como aceptación", async () => {
    const sessions = mockSession(baseSession("nuevo", "lead-existing"))
    ;(hasConsented as jest.Mock).mockResolvedValue(false)

    await handleIncomingMessage({
      phone: PHONE,
      text: "Quiero turno, tengo OSDE y prefiero Lanús",
      waMessageId: "wamid.consent-1",
    })

    expect(extractIntake).not.toHaveBeenCalled()
    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({ leadId: null }))
    expect(sendText).not.toHaveBeenCalled()
    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("política de privacidad"),
      expect.arrayContaining([{ id: CONSENT_ACCEPT_BUTTON_ID, title: "Acepto y continúo" }]),
      expect.objectContaining({ flowIntent: "consent_request" })
    )
    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({ state: "esperando_consentimiento" }))
  })

  it("una respuesta ambigua no registra consentimiento ni avanza al intake", async () => {
    mockSession(baseSession("esperando_consentimiento"))

    await handleIncomingMessage({ phone: PHONE, text: "Tengo OSDE", waMessageId: "wamid.consent-2" })

    expect(recordConsent).not.toHaveBeenCalled()
    expect(extractIntake).not.toHaveBeenCalled()
    expect(sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("respuesta explícita"),
      expect.any(Array),
      expect.anything()
    )
  })

  it("el botón explícito registra evidencia y recién entonces solicita datos administrativos", async () => {
    const sessions = mockSession(baseSession("esperando_consentimiento"))

    await handleIncomingMessage({
      phone: PHONE,
      text: "Acepto y continúo",
      messageType: "button_reply",
      buttonId: CONSENT_ACCEPT_BUTTON_ID,
      waMessageId: "wamid.consent-3",
    })

    expect(recordConsent).toHaveBeenCalledWith(expect.objectContaining({
      waId: PHONE,
      consented: true,
      evidenceMessageId: "wamid.consent-3",
    }))
    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.not.stringMatching(/síntoma|estudio previo/i),
      expect.objectContaining({ flowIntent: "pedir_turno" })
    )
    expect(sessions.update).toHaveBeenCalledWith(expect.objectContaining({ state: "intake_pendiente" }))
  })

  it("no persiste el texto de una consulta clínica aunque exista consentimiento administrativo", async () => {
    mockSession(baseSession("derivado", "lead-existing"))
    ;(hasConsented as jest.Mock).mockResolvedValue(true)
    ;(isMedicalBoundaryMessage as jest.Mock).mockReturnValueOnce(true)

    await handleIncomingMessage({
      phone: PHONE,
      text: "¿Dejo de tomar la medicación?",
      waMessageId: "wamid.medical-boundary",
    })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      flowIntent: "medical_boundary",
    }))
    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      "respuesta fija de límite médico",
      expect.objectContaining({ flowIntent: "medical_boundary" })
    )
    expect(extractIntake).not.toHaveBeenCalled()
  })

  it("no persiste ni envía a IA una afirmación de síntomas que no formula una pregunta", async () => {
    mockSession(baseSession("derivado", "lead-existing"))
    ;(hasConsented as jest.Mock).mockResolvedValue(true)
    ;(containsSensitiveMedicalContent as jest.Mock).mockReturnValueOnce(true)

    await handleIncomingMessage({
      phone: PHONE,
      text: "tengo palpitaciones",
      waMessageId: "wamid.sensitive-statement",
    })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      content: "",
      flowIntent: "medical_content_redacted",
    }))
    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      "respuesta fija de redacción clínica",
      expect.objectContaining({ flowIntent: "medical_content_redacted" })
    )
    expect(extractIntake).not.toHaveBeenCalled()
    expect(classifyIntent).not.toHaveBeenCalled()
  })
})
