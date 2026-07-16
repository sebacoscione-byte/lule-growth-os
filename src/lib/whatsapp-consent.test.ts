jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import {
  CONSENT_ACCEPT_BUTTON_ID,
  CONSENT_DECLINE_BUTTON_ID,
  CONSENT_PURPOSE,
  CONSENT_VERSION,
  hasConsented,
  interpretConsentReply,
  recordConsent,
  recordResearchProtocolConsent,
  PROTOCOL_CONSENT_PURPOSE,
  PROTOCOL_CONSENT_VERSION,
} from "@/lib/whatsapp-consent"
import { getServiceDb } from "@/lib/supabase/service"

describe("interpretConsentReply", () => {
  it.each([
    ["Sí, acepto", undefined],
    ["Acepto y continúo", undefined],
    ["", CONSENT_ACCEPT_BUTTON_ID],
  ])("acepta únicamente una manifestación positiva explícita", (text, buttonId) => {
    expect(interpretConsentReply(text, buttonId)).toBe("accepted")
  })

  it.each([
    ["no", undefined],
    ["No acepto, gracias", undefined],
    ["No autorizo el uso de mis datos", undefined],
    ["Sí, no acepto", undefined],
    ["Sí, prefiero que no", undefined],
    ["", CONSENT_DECLINE_BUTTON_ID],
  ])("reconoce un rechazo explícito", (text, buttonId) => {
    expect(interpretConsentReply(text, buttonId)).toBe("declined")
  })

  it.each([
    "Turno cardiológico, tengo OSDE, 45 años, zona Lanús",
    "Quiero un ecocardiograma",
    "ok",
    "continuar",
  ])("no infiere consentimiento a partir de datos o respuestas ambiguas: %s", text => {
    expect(interpretConsentReply(text)).toBe("unknown")
  })

  it("no confunde un botón de otro flujo con consentimiento administrativo", () => {
    expect(interpretConsentReply("Sí, quiero más información", "protocol_opt_in")).toBe("unknown")
  })
})

describe("persistencia del consentimiento", () => {
  beforeEach(() => jest.clearAllMocks())

  it("solo reconoce la finalidad y versión explícitas actuales", async () => {
    const builder: Record<string, jest.Mock> = {}
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = jest.fn(() => builder)
    }
    builder.maybeSingle = jest.fn().mockResolvedValue({ data: { consented: true }, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => builder) })

    await expect(hasConsented("5491100000000")).resolves.toBe(true)
    expect(builder.eq).toHaveBeenCalledWith("purpose", CONSENT_PURPOSE)
    expect(builder.eq).toHaveBeenCalledWith("version", CONSENT_VERSION)
  })

  it("falla cerrado si no puede guardar la evidencia", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: { message: "db unavailable" } })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => ({ upsert })) })

    await expect(recordConsent({
      waId: "5491100000000",
      consented: true,
      evidenceMessageId: "wamid.test",
    })).rejects.toThrow("No se pudo registrar el consentimiento administrativo")
  })

  it("separa la aceptación de información de protocolo y no la trata como elegibilidad", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => ({ upsert })) })

    await recordResearchProtocolConsent({
      waId: "5491100000000",
      leadId: "lead-protocol",
      consented: true,
      evidenceMessageId: "wamid.protocol",
    })

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      purpose: PROTOCOL_CONSENT_PURPOSE,
      version: PROTOCOL_CONSENT_VERSION,
      consented: true,
      evidence_message_id: "wamid.protocol",
    }), { onConflict: "purpose,evidence_message_id", ignoreDuplicates: true })
  })
})
