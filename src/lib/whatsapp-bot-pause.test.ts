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
  FOLLOWUP_CONSENT_TEXT: "¿Querés que te escribamos una sola vez para saber si pediste turno?",
  FOLLOWUP_ACCEPT_BUTTON_ID: "followup_accept_once",
  FOLLOWUP_DECLINE_BUTTON_ID: "followup_decline",
  recordAppointmentFollowupConsent: jest.fn().mockResolvedValue(undefined),
  recordResearchProtocolConsent: jest.fn().mockResolvedValue(undefined),
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

import { handleIncomingMessage, UNSUPPORTED_MEDIA_REPLY } from "@/lib/whatsapp-bot"
import { getServiceDb } from "@/lib/supabase/service"
import { sendText, sendButtons } from "@/lib/whatsapp"
import { escalateToHuman } from "@/lib/whatsapp-handoff"
import {
  containsSensitiveMedicalContent,
  isEmergencyMessage,
  isMedicalBoundaryMessage,
} from "@/lib/medical-safety"
import { isMarketingOptOutMessage } from "@/lib/whatsapp-intents"
import { classifyIntent, classifyProtocolButtonReply } from "@/lib/whatsapp-intents"
import {
  hasConsented,
  interpretConsentReply,
  recordAppointmentFollowupConsent,
  recordResearchProtocolConsent,
} from "@/lib/whatsapp-consent"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"
import { logWhatsAppMessage } from "@/lib/whatsapp-cost-tracking"

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
  const rpc = jest.fn().mockImplementation((name: string) => {
    if (name === "ensure_whatsapp_lead") {
      return Promise.resolve({ data: opts.session.lead_id ?? "lead-created", error: null })
    }
    throw new Error(`rpc inesperada en el mock: ${name}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy, rpc })
  return { sessionsBuilder, leadsBuilder, appConfigBuilder, fromSpy, rpc }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(sendText as jest.Mock).mockResolvedValue({})
  ;(isEmergencyMessage as jest.Mock).mockReturnValue(false)
  ;(isMedicalBoundaryMessage as jest.Mock).mockReturnValue(false)
  ;(containsSensitiveMedicalContent as jest.Mock).mockReturnValue(false)
  ;(isMarketingOptOutMessage as jest.Mock).mockReturnValue(false)
  ;(hasConsented as jest.Mock).mockResolvedValue(true)
  ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({
    bot_enabled: true,
    session_ttl_hours: 24,
    cost_saving_mode: false,
    enable_service_message_charging: false,
    warning_message_threshold: 8,
    handoff_message_threshold: 12,
    monthly_cost_alert_ars: null,
    ai_provider: "sin_ia",
  })
})

describe("handleIncomingMessage — bot_paused", () => {
  it("persiste el mensaje normal del handoff con retencion transitoria", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })

    await handleIncomingMessage({ phone: PHONE, text: "hola, queria preguntar algo" })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: "lead-1",
      content: "hola, queria preguntar algo",
      retentionClass: "handoff_transient",
    }))
    expect(sendText).not.toHaveBeenCalled()
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("mantiene visible el handoff aunque el consentimiento administrativo no este vigente", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })
    ;(hasConsented as jest.Mock).mockResolvedValue(false)

    await handleIncomingMessage({ phone: PHONE, text: "gracias doc", waMessageId: "wamid.handoff.1" })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: "lead-1",
      content: "gracias doc",
      retentionClass: "handoff_transient",
      waMessageId: "wamid.handoff.1",
    }))
    expect(sendText).not.toHaveBeenCalled()
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("muestra una consulta sensible al equipo durante el handoff sin IA ni respuesta", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })
    ;(isMedicalBoundaryMessage as jest.Mock).mockReturnValue(true)

    const text = "Puedo hacerme el electro la semana que viene?"
    await handleIncomingMessage({ phone: PHONE, text, waMessageId: "wamid.handoff.2" })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: "lead-1",
      content: text,
      retentionClass: "handoff_transient",
      flowIntent: "medical_boundary",
    }))
    expect(sendText).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("fuera del handoff sigue redactando el contenido sensible antes del CRM", async () => {
    mockDb({ session: baseSession({ bot_paused: false }) })
    ;(containsSensitiveMedicalContent as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({ phone: PHONE, text: "tengo un sintoma" })

    expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      content: "",
    }))
    expect(logWhatsAppMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      retentionClass: "handoff_transient",
    }))
    expect(classifyIntent).not.toHaveBeenCalled()
  })

  it("con el bot pausado, un mensaje normal no dispara ninguna respuesta automática", async () => {
    mockDb({ session: baseSession({ bot_paused: true }) })

    await handleIncomingMessage({ phone: PHONE, text: "hola, quería preguntar algo" })

    expect(sendText).not.toHaveBeenCalled()
    expect(escalateToHuman).not.toHaveBeenCalled()
  })

  it("sin pausa, el mismo mensaje sí dispara la respuesta normal del bot (control)", async () => {
    mockDb({ session: baseSession({ bot_paused: false }) })

    await handleIncomingMessage({ phone: PHONE, text: "hola, quería preguntar algo" })

    // "otro_no_entendido" (mockeado por defecto en este archivo) ahora siempre ofrece el botón de
    // "Hablar con humano" -- ver whatsapp-bot-message-recovery.test.ts / whatsapp-bot.ts.
    expect(sendButtons).toHaveBeenCalled()
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

describe("handleIncomingMessage — controles operativos de Fase 0B", () => {
  it.each(["audio", "image", "document", "sticker"] as const)(
    "responde %s con el catalogo tecnico, sin IA, handoff ni contenido persistido",
    async messageType => {
      mockDb({ session: baseSession({ bot_paused: true }) })

      await handleIncomingMessage({ phone: PHONE, text: "", messageType })

      expect(sendText).toHaveBeenCalledWith(
        PHONE,
        UNSUPPORTED_MEDIA_REPLY,
        expect.objectContaining({ flowIntent: "unsupported_media" })
      )
      expect(classifyIntent).not.toHaveBeenCalled()
      expect(escalateToHuman).not.toHaveBeenCalled()
      expect(logWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
        messageType,
        content: "",
        leadId: null,
      }))
    }
  )

  it("el kill switch silencia el flujo normal", async () => {
    ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({
      bot_enabled: false,
      session_ttl_hours: 24,
      cost_saving_mode: false,
      enable_service_message_charging: false,
      warning_message_threshold: 8,
      handoff_message_threshold: 12,
      monthly_cost_alert_ars: null,
      ai_provider: "sin_ia",
    })
    mockDb({ session: baseSession() })

    await handleIncomingMessage({ phone: PHONE, text: "hola, necesito un turno" })

    expect(sendText).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
    expect(classifyIntent).not.toHaveBeenCalled()
    expect(escalateToHuman).not.toHaveBeenCalled()
  })

  it("el kill switch no desactiva el guardrail de emergencia", async () => {
    ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({
      bot_enabled: false,
      session_ttl_hours: 24,
      cost_saving_mode: false,
      enable_service_message_charging: false,
      warning_message_threshold: 8,
      handoff_message_threshold: 12,
      monthly_cost_alert_ars: null,
      ai_provider: "sin_ia",
    })
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)
    mockDb({ session: baseSession(), lead: { id: "lead-1" } })

    await handleIncomingMessage({ phone: PHONE, text: "dolor fuerte de pecho y falta de aire" })

    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("107"),
      expect.objectContaining({ flowIntent: "urgencia_medica" })
    )
    expect(escalateToHuman).toHaveBeenCalled()
  })

  it("persiste el handoff de emergencia aunque Meta rechace la respuesta al paciente", async () => {
    mockDb({ session: baseSession({ bot_paused: true }), lead: { id: "lead-1" } })
    ;(isEmergencyMessage as jest.Mock).mockReturnValue(true)
    ;(sendText as jest.Mock).mockRejectedValueOnce(new Error("provider_unavailable"))

    await expect(
      handleIncomingMessage({ phone: PHONE, text: "tengo un dolor fuerte en el pecho" })
    ).rejects.toThrow("provider_unavailable")

    expect(escalateToHuman).toHaveBeenCalled()
    expect((escalateToHuman as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (sendText as jest.Mock).mock.invocationCallOrder[0]
    )
  })

  it("reinicia solo la sesion remitente luego del TTL y no envia un aviso de timeout", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const { sessionsBuilder } = mockDb({
      session: baseSession({ state: "intake_pendiente", updated_at: old }),
    })

    await handleIncomingMessage({ phone: PHONE, text: "hola" })

    expect(sessionsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      state: "nuevo",
      obra_social: null,
    }))
    expect(sendText).toHaveBeenCalledTimes(1)
    const sentBodies = (sendText as jest.Mock).mock.calls.map(call => String(call[1])).join("\n")
    expect(sentBodies).not.toMatch(/inactividad|timeout|2 minutos/i)
  })

  it("registra opt-in de seguimiento explicito y agenda un unico contacto", async () => {
    const { leadsBuilder, sessionsBuilder } = mockDb({
      session: baseSession({ state: "esperando_seguimiento" }),
    })
    ;(interpretConsentReply as jest.Mock).mockReturnValue("accepted")

    await handleIncomingMessage({
      phone: PHONE,
      text: "Sí, una vez",
      messageType: "button_reply",
      buttonId: "followup_accept_once",
      waMessageId: "wamid.followup",
    })

    expect(recordAppointmentFollowupConsent).toHaveBeenCalledWith({
      waId: PHONE,
      leadId: "lead-1",
      consented: true,
      evidenceMessageId: "wamid.followup",
    })
    expect(leadsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      consent_to_contact: true,
      followup_due_at: expect.any(String),
    }))
    expect(sessionsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ state: "derivado" }))
    expect(sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringMatching(/una sola vez/i),
      expect.objectContaining({ flowIntent: "appointment_followup_consent" })
    )
  })

  it("'No, gracias' del seguimiento no se confunde con una baja de protocolos", async () => {
    const { leadsBuilder, sessionsBuilder } = mockDb({
      session: baseSession({ state: "esperando_seguimiento" }),
    })
    ;(interpretConsentReply as jest.Mock).mockReturnValue("declined")
    ;(classifyProtocolButtonReply as jest.Mock).mockReturnValue("opt_out")

    await handleIncomingMessage({
      phone: PHONE,
      text: "No, gracias",
      messageType: "button_reply",
      buttonId: "followup_decline",
      waMessageId: "wamid.followup-decline",
    })

    expect(classifyProtocolButtonReply).not.toHaveBeenCalled()
    expect(recordResearchProtocolConsent).not.toHaveBeenCalled()
    expect(recordAppointmentFollowupConsent).toHaveBeenCalledWith({
      waId: PHONE,
      leadId: "lead-1",
      consented: false,
      evidenceMessageId: "wamid.followup-decline",
    })
    expect(leadsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      followup_due_at: null,
      whatsapp_followup_status: "declined",
    }))
    expect(sessionsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ state: "derivado" }))
  })

  it("una baja revoca el opt-in de seguimiento aun con bot pausado", async () => {
    const { leadsBuilder } = mockDb({ session: baseSession({ bot_paused: true }) })
    ;(isMarketingOptOutMessage as jest.Mock).mockReturnValue(true)

    await handleIncomingMessage({
      phone: PHONE,
      text: "BAJA",
      waMessageId: "wamid.stop",
    })

    expect(recordAppointmentFollowupConsent).toHaveBeenCalledWith({
      waId: PHONE,
      leadId: "lead-1",
      consented: false,
      evidenceMessageId: "wamid.stop",
      source: "whatsapp_opt_out",
    })
    expect(leadsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      consent_to_contact: false,
      followup_due_at: null,
      whatsapp_followup_status: "cancelled",
      whatsapp_followup_claimed_at: null,
    }))
  })

  it("un opt-in de protocolo registra su finalidad y exige revisión humana sin marcar elegibilidad", async () => {
    const { leadsBuilder } = mockDb({
      session: baseSession(),
      lead: {
        id: "lead-1",
        name: null,
        insurance: null,
        patient_age: null,
        general_reason: null,
        possible_emergency: false,
        protocol_interest: false,
        protocol_name: null,
        last_message: null,
      },
    })
    ;(classifyProtocolButtonReply as jest.Mock).mockReturnValueOnce("opt_in")

    await handleIncomingMessage({
      phone: PHONE,
      text: "Sí, quiero más información",
      messageType: "button_reply",
      buttonId: "protocol_opt_in",
      waMessageId: "wamid.protocol",
    })

    expect(recordResearchProtocolConsent).toHaveBeenCalledWith({
      waId: PHONE,
      leadId: "lead-1",
      consented: true,
      evidenceMessageId: "wamid.protocol",
    })
    expect(leadsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      protocol_interest: true,
      protocol_opt_out: false,
      status: "requiere_humano",
    }))
    expect(leadsBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "elegible_protocolo",
    }))
    expect(escalateToHuman).toHaveBeenCalled()
  })
})
