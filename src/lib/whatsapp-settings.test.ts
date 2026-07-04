import { isHighValueLead, mergeWhatsAppSettings, shouldForceHandoff } from "@/lib/whatsapp-settings"
import type { LeadStatus } from "@/types"

function lead(overrides: Partial<{ status: LeadStatus; protocol_interest: boolean; possible_emergency: boolean }>) {
  return { status: "nuevo" as LeadStatus, protocol_interest: false, possible_emergency: false, ...overrides }
}

describe("isHighValueLead", () => {
  it("un lead sin nada especial no es de alto valor", () => {
    expect(isHighValueLead(lead({}))).toBe(false)
  })

  it("un turno casi confirmado (derivado) es alto valor", () => {
    expect(isHighValueLead(lead({ status: "derivado_cimel" }))).toBe(true)
  })

  it("un interesado en protocolo es alto valor", () => {
    expect(isHighValueLead(lead({ protocol_interest: true }))).toBe(true)
  })

  it("una posible urgencia es alto valor", () => {
    expect(isHighValueLead(lead({ possible_emergency: true }))).toBe(true)
  })

  it("sin lead todavia (null) no es alto valor", () => {
    expect(isHighValueLead(null)).toBe(false)
  })
})

describe("mergeWhatsAppSettings", () => {
  it("sin nada guardado usa los defaults (modo ahorro apagado)", () => {
    const settings = mergeWhatsAppSettings(null)
    expect(settings.cost_saving_mode).toBe(false)
    expect(settings.enable_service_message_charging).toBe(false)
    expect(settings.ai_provider).toBe("sin_ia")
  })

  it("activar enable_service_message_charging fuerza cost_saving_mode automaticamente", () => {
    const settings = mergeWhatsAppSettings({ enable_service_message_charging: true, cost_saving_mode: false })
    expect(settings.cost_saving_mode).toBe(true)
  })

  it("respeta cost_saving_mode manual cuando el flag de octubre 2026 esta apagado", () => {
    const settings = mergeWhatsAppSettings({ cost_saving_mode: true, enable_service_message_charging: false })
    expect(settings.cost_saving_mode).toBe(true)
  })
})

describe("shouldForceHandoff", () => {
  it("por debajo del umbral de derivacion no fuerza handoff", () => {
    expect(shouldForceHandoff(5, 12, false)).toBe(false)
  })

  it("en el umbral de derivacion fuerza handoff si no es alto valor", () => {
    expect(shouldForceHandoff(12, 12, false)).toBe(true)
  })

  it("un lead de alto valor no se deriva aunque supere el umbral", () => {
    expect(shouldForceHandoff(20, 12, true)).toBe(false)
  })
})
