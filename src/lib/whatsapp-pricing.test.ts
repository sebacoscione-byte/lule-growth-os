import { resolvePrice, getEffectivePricingDate } from "@/lib/whatsapp-pricing"
import type { WhatsAppPricingRule } from "@/types"

function rule(overrides: Partial<WhatsAppPricingRule>): WhatsAppPricingRule {
  return {
    id: "id",
    country_code: "AR",
    currency: "ARS",
    category: "service",
    is_template: false,
    in_window: true,
    entry_point: "organic",
    provider: "cloud_api",
    cost_amount: 0,
    valid_from: "2025-07-01",
    valid_to: null,
    source_note: null,
    ...overrides,
  }
}

const RULES: WhatsAppPricingRule[] = [
  rule({ category: "service", in_window: true, entry_point: "organic", cost_amount: 0, valid_from: "2025-07-01", valid_to: "2026-09-30" }),
  rule({ category: "service", in_window: true, entry_point: "organic", cost_amount: null, valid_from: "2026-10-01", valid_to: null }),
  rule({ category: "marketing", is_template: true, in_window: false, entry_point: "organic", cost_amount: null, valid_from: "2025-07-01" }),
  rule({ category: "service", in_window: true, entry_point: "ctwa", cost_amount: 0, valid_from: "2025-07-01", valid_to: null }),
]

describe("resolvePrice", () => {
  it("mensaje service dentro de ventana antes del 1/10/2026 es gratis", () => {
    const result = resolvePrice(RULES, {
      countryCode: "AR", category: "service", isTemplate: false, inWindow: true,
      entryPoint: "organic", date: new Date("2026-07-04"),
    })
    expect(result.billable).toBe(false)
    expect(result.cost).toBe(0)
  })

  it("mensaje service dentro de ventana desde el 1/10/2026 pasa a ser facturable", () => {
    const result = resolvePrice(RULES, {
      countryCode: "AR", category: "service", isTemplate: false, inWindow: true,
      entryPoint: "organic", date: new Date("2026-10-02"),
    })
    expect(result.billable).toBe(true)
    expect(result.cost).toBeNull() // pendiente de completar con el tarifario real
  })

  it("Free Entry Point (Click-to-WhatsApp) es siempre gratis aunque sea despues del 1/10/2026", () => {
    const result = resolvePrice(RULES, {
      countryCode: "AR", category: "service", isTemplate: false, inWindow: true,
      entryPoint: "ctwa", date: new Date("2026-12-01"),
    })
    expect(result.billable).toBe(false)
    expect(result.cost).toBe(0)
  })

  it("template marketing fuera de ventana es facturable", () => {
    const result = resolvePrice(RULES, {
      countryCode: "AR", category: "marketing", isTemplate: true, inWindow: false,
      entryPoint: "organic", date: new Date("2026-07-04"),
    })
    expect(result.billable).toBe(true)
  })

  it("sin regla que matchee devuelve billable=false y costo desconocido", () => {
    const result = resolvePrice(RULES, {
      countryCode: "BR", category: "authentication", isTemplate: true, inWindow: false,
      entryPoint: "organic", date: new Date("2026-07-04"),
    })
    expect(result.rule).toBeNull()
    expect(result.cost).toBeNull()
    expect(result.billable).toBe(false)
  })
})

describe("getEffectivePricingDate", () => {
  it("con el flag apagado usa la fecha real", () => {
    const today = new Date("2026-07-04")
    expect(getEffectivePricingDate(today, false)).toEqual(today)
  })

  it("con el flag prendido antes de octubre 2026 adelanta al 1/10/2026", () => {
    const today = new Date("2026-07-04")
    expect(getEffectivePricingDate(today, true).toISOString().slice(0, 10)).toBe("2026-10-01")
  })

  it("con el flag prendido despues de octubre 2026 no retrocede la fecha", () => {
    const today = new Date("2026-11-15")
    expect(getEffectivePricingDate(today, true)).toEqual(today)
  })
})
