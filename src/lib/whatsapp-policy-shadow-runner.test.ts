const insertMock = jest.fn().mockResolvedValue({ error: null })
const maybeSingleMock = jest.fn().mockResolvedValue({ data: null })

jest.mock("@/lib/supabase/service", () => ({
  getServiceDb: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: maybeSingleMock,
        })),
      })),
      insert: insertMock,
    })),
  })),
}))

import {
  deriveLegacyComparableDecision,
  evaluateWhatsAppPolicyShadow,
  mapBotStateToPolicyState,
  mapMessageTypeToInputType,
  type LegacySignals,
} from "@/lib/whatsapp-policy-shadow-runner"

function signals(overrides: Partial<LegacySignals> = {}): LegacySignals {
  return {
    emergencyDetected: false,
    marketingOptOut: false,
    unsupportedMessage: false,
    botPaused: false,
    medicalBoundaryDetected: false,
    sensitiveMedicalContentDetected: false,
    botEnabled: true,
    sessionState: "derivado",
    forceHandoffTriggered: false,
    messageType: "text",
    text: "",
    ...overrides,
  }
}

describe("mapBotStateToPolicyState", () => {
  it("mapea cada estado legacy a un estado v2 valido", () => {
    expect(mapBotStateToPolicyState("nuevo")).toBe("new")
    expect(mapBotStateToPolicyState("esperando_consentimiento")).toBe("awaiting_consent")
    expect(mapBotStateToPolicyState("intake_pendiente")).toBe("awaiting_service")
    expect(mapBotStateToPolicyState("esperando_obra_social")).toBe("awaiting_coverage")
    expect(mapBotStateToPolicyState("esperando_sede")).toBe("awaiting_location")
    expect(mapBotStateToPolicyState("esperando_seguimiento")).toBe("routed")
    expect(mapBotStateToPolicyState("derivado")).toBe("routed")
    expect(mapBotStateToPolicyState("handoff_pending")).toBe("handoff_pending")
    expect(mapBotStateToPolicyState("human_active")).toBe("human_active")
    expect(mapBotStateToPolicyState("closed")).toBe("closed")
  })
})

describe("mapMessageTypeToInputType", () => {
  it("mapea cada tipo de mensaje legacy a un input_type v2 valido", () => {
    expect(mapMessageTypeToInputType("text")).toBe("text")
    expect(mapMessageTypeToInputType("button_reply")).toBe("button")
    expect(mapMessageTypeToInputType("list_reply")).toBe("list")
    expect(mapMessageTypeToInputType("contacts")).toBe("contact")
    expect(mapMessageTypeToInputType("unknown")).toBe("unknown")
  })
})

describe("deriveLegacyComparableDecision", () => {
  it("una urgencia detectada siempre gana, sin importar el resto de las señales", () => {
    const decision = deriveLegacyComparableDecision(signals({ emergencyDetected: true, botPaused: true }))
    expect(decision).toEqual({
      action: "emergency", intent: "symptom_question", response_key: "possible_emergency", handoff: true,
    })
  })

  it("una baja de contacto (BAJA/STOP) es un opt_out sin handoff", () => {
    const decision = deriveLegacyComparableDecision(signals({ marketingOptOut: true }))
    expect(decision).toEqual({
      action: "opt_out", intent: "unknown", response_key: "opt_out_confirmed", handoff: false,
    })
  })

  it("un adjunto no soportado no produce handoff", () => {
    const decision = deriveLegacyComparableDecision(signals({ unsupportedMessage: true }))
    expect(decision?.response_key).toBe("unsupported_media")
    expect(decision?.handoff).toBe(false)
  })

  it("el bot pausado no tiene ninguna decision que comparar (no contesta nada)", () => {
    expect(deriveLegacyComparableDecision(signals({ botPaused: true }))).toBeNull()
  })

  it("un limite clinico (pregunta medica) no escala a un humano", () => {
    const decision = deriveLegacyComparableDecision(signals({ medicalBoundaryDetected: true }))
    expect(decision?.response_key).toBe("medical_boundary")
    expect(decision?.handoff).toBe(false)
  })

  it("contenido medico sensible usa la misma clave que el limite clinico", () => {
    const decision = deriveLegacyComparableDecision(signals({ sensitiveMedicalContentDetected: true }))
    expect(decision?.response_key).toBe("medical_boundary")
  })

  it("el kill switch global no produce ninguna decision", () => {
    expect(deriveLegacyComparableDecision(signals({ botEnabled: false }))).toBeNull()
  })

  it("una conversacion ya en manos de un humano o cerrada no produce ninguna decision", () => {
    expect(deriveLegacyComparableDecision(signals({ sessionState: "handoff_pending" }))).toBeNull()
    expect(deriveLegacyComparableDecision(signals({ sessionState: "human_active" }))).toBeNull()
    expect(deriveLegacyComparableDecision(signals({ sessionState: "closed" }))).toBeNull()
  })

  it("la derivacion forzada por longitud de conversacion es un handoff", () => {
    const decision = deriveLegacyComparableDecision(signals({ forceHandoffTriggered: true }))
    expect(decision).toEqual({
      action: "handoff", intent: "unknown", response_key: "human_handoff", handoff: true,
    })
  })

  it("el boton hablar_humano es un handoff explicito", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ messageType: "button_reply", buttonId: "hablar_humano" })
    )
    expect(decision).toEqual({
      action: "handoff", intent: "unknown", response_key: "human_handoff", handoff: true,
    })
  })

  it("el boton de baja de protocolo es un opt_out sin handoff", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ messageType: "button_reply", text: "No, gracias" })
    )
    expect(decision).toEqual({
      action: "opt_out", intent: "research_protocol", response_key: "opt_out_protocol", handoff: false,
    })
  })

  it("el boton de aceptacion de protocolo es un handoff", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ messageType: "button_reply", text: "Sí, quiero más información" })
    )
    expect(decision).toEqual({
      action: "handoff", intent: "research_protocol", response_key: "human_handoff", handoff: true,
    })
  })

  it("el boton de baja de protocolo no aplica durante esperando_seguimiento (mismo texto, otro boton)", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ messageType: "button_reply", sessionState: "esperando_seguimiento", text: "No, gracias" })
    )
    expect(decision).toBeNull()
  })

  it("cancelar_reprogramar en derivado es un handoff con instrucciones", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ sessionState: "derivado", messageType: "text", text: "quiero cancelar mi turno" })
    )
    expect(decision).toEqual({
      action: "handoff", intent: "cancel_or_reschedule", response_key: "show_booking_instructions", handoff: true,
    })
  })

  it("hablar_con_humano en derivado es un handoff", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ sessionState: "derivado", messageType: "text", text: "quiero hablar con una persona" })
    )
    expect(decision?.response_key).toBe("human_handoff")
    expect(decision?.handoff).toBe(true)
  })

  it("turno_ya_resuelto en derivado cierra sin handoff", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ sessionState: "derivado", messageType: "text", text: "ya tengo turno, gracias igual" })
    )
    expect(decision).toEqual({
      action: "continue", intent: "appointment_already_solved", response_key: "thanks_close", handoff: false,
    })
  })

  it("derivar_protocolo en derivado es un handoff", () => {
    const decision = deriveLegacyComparableDecision(
      signals({ sessionState: "derivado", messageType: "text", text: "quiero saber del protocolo de investigación" })
    )
    expect(decision?.response_key).toBe("human_handoff")
    expect(decision?.intent).toBe("research_protocol")
  })

  it("un texto sin ninguna regla deterministica en derivado queda fuera de alcance (null)", () => {
    expect(
      deriveLegacyComparableDecision(
        signals({ sessionState: "derivado", messageType: "text", text: "che una duda rara" })
      )
    ).toBeNull()
  })

  it("los estados de intake/sede/cobertura quedan fuera de alcance de esta fase (null)", () => {
    expect(deriveLegacyComparableDecision(signals({ sessionState: "nuevo", text: "hola" }))).toBeNull()
    expect(deriveLegacyComparableDecision(signals({ sessionState: "intake_pendiente", text: "quiero un turno" }))).toBeNull()
    expect(deriveLegacyComparableDecision(signals({ sessionState: "esperando_sede", text: "cimel" }))).toBeNull()
  })
})

describe("evaluateWhatsAppPolicyShadow", () => {
  beforeEach(() => {
    insertMock.mockClear()
    maybeSingleMock.mockClear()
  })

  it("no inserta nada cuando la decision legacy queda fuera de alcance", async () => {
    await evaluateWhatsAppPolicyShadow({
      phone: "5491100000000",
      text: "che una duda rara",
      messageType: "text",
      leadId: null,
      sessionState: "derivado",
      messagesSentCount: 1,
      handoffMessageThreshold: 12,
      emergencyDetected: false,
      marketingOptOut: false,
      unsupportedMessage: false,
      botPaused: false,
      medicalBoundaryDetected: false,
      sensitiveMedicalContentDetected: false,
      botEnabled: true,
    })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it("inserta un registro valido (hashes, sin PII) cuando la decision legacy si aplica", async () => {
    await evaluateWhatsAppPolicyShadow({
      phone: "5491100000000",
      text: "urgencia",
      messageType: "text",
      waMessageId: "wamid.test123",
      leadId: null,
      sessionState: "derivado",
      messagesSentCount: 1,
      handoffMessageThreshold: 12,
      emergencyDetected: true,
      marketingOptOut: false,
      unsupportedMessage: false,
      botPaused: false,
      medicalBoundaryDetected: false,
      sensitiveMedicalContentDetected: false,
      botEnabled: true,
    })
    expect(insertMock).toHaveBeenCalledTimes(1)
    const record = insertMock.mock.calls[0][0]
    expect(record.event_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.conversation_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(record.legacy_action).toBe("emergency")
    expect(record.served_by).toBe("legacy")
    expect(JSON.stringify(record)).not.toContain("5491100000000")
  })

  it("nunca lanza, ni siquiera si la base de datos falla", async () => {
    insertMock.mockRejectedValueOnce(new Error("boom"))
    await expect(evaluateWhatsAppPolicyShadow({
      phone: "5491100000000",
      text: "urgencia",
      messageType: "text",
      leadId: null,
      sessionState: "derivado",
      messagesSentCount: 1,
      handoffMessageThreshold: 12,
      emergencyDetected: true,
      marketingOptOut: false,
      unsupportedMessage: false,
      botPaused: false,
      medicalBoundaryDetected: false,
      sensitiveMedicalContentDetected: false,
      botEnabled: true,
    })).resolves.toBeUndefined()
  })
})
