jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import {
  getWhatsAppSettings,
  isHighValueLead,
  mergeWhatsAppSettings,
  shouldForceHandoff,
} from "@/lib/whatsapp-settings"
import { getServiceDb } from "@/lib/supabase/service"
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
    expect(isHighValueLead(lead({ status: "derivado_britanico" }))).toBe(true)
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
    expect(settings.bot_enabled).toBe(true)
    expect(settings.session_ttl_hours).toBe(24)
    expect(settings.shadow_mode_enabled).toBe(false)
    expect(settings.policy_rollout_percent).toBe(0)
    expect(settings.enable_service_message_charging).toBe(false)
    expect(settings.ai_provider).toBe("sin_ia")
  })

  it("acota TTL y rollout a rangos operativos seguros", () => {
    expect(mergeWhatsAppSettings({ session_ttl_hours: 0, policy_rollout_percent: -20 }).session_ttl_hours).toBe(24)
    expect(mergeWhatsAppSettings({ session_ttl_hours: 500, policy_rollout_percent: 140, shadow_mode_enabled: true })).toEqual(
      expect.objectContaining({ session_ttl_hours: 168, policy_rollout_percent: 0, shadow_mode_enabled: false })
    )
  })

  it("activar enable_service_message_charging fuerza cost_saving_mode automaticamente", () => {
    const settings = mergeWhatsAppSettings({ enable_service_message_charging: true, cost_saving_mode: false })
    expect(settings.cost_saving_mode).toBe(true)
  })

  it("respeta cost_saving_mode manual cuando el flag de octubre 2026 esta apagado", () => {
    const settings = mergeWhatsAppSettings({ cost_saving_mode: true, enable_service_message_charging: false })
    expect(settings.cost_saving_mode).toBe(true)
  })

  it("descarta una configuración persistida con tipos inválidos", () => {
    const settings = mergeWhatsAppSettings({ bot_enabled: "false" } as unknown as Parameters<typeof mergeWhatsAppSettings>[0])
    expect(settings.bot_enabled).toBe(false)
    expect(settings.ai_provider).toBe("sin_ia")
  })
})

describe("getWhatsAppSettings", () => {
  it("apaga el bot si la fila de configuración no existe", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
    const builder = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle,
    }
    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => builder) })

    await expect(getWhatsAppSettings()).resolves.toEqual(
      expect.objectContaining({ bot_enabled: false })
    )
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
