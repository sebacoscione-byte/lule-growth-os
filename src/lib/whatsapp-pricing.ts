import { getServiceDb } from "@/lib/supabase/service"
import type { WhatsAppCategory, WhatsAppEntryPoint, WhatsAppPricingRule } from "@/types"

export interface PriceQuery {
  countryCode: string
  category: WhatsAppCategory
  isTemplate: boolean
  inWindow: boolean
  entryPoint: WhatsAppEntryPoint
  date?: Date
}

export interface ResolvedPrice {
  cost: number | null
  currency: string | null
  /** true si el mensaje se cobra; false si esta regla lo cubre gratis (FEP o ventana gratuita vigente). */
  billable: boolean
  rule: WhatsAppPricingRule | null
}

const OCT_2026_CUTOVER = new Date("2026-10-01T00:00:00Z")

/**
 * `enable_service_message_charging` permite al equipo probar/preparar el sistema para el cambio de
 * precios de Meta antes de que llegue la fecha real, adelantando la fecha de referencia usada para
 * resolver el tarifario. No inventa un monto: si la regla del 1/10/2026 todavía no tiene cost_amount
 * cargado, billable queda en true con cost null (visible como pendiente en el dashboard).
 */
export function getEffectivePricingDate(today: Date, serviceMessageChargingEnabled: boolean): Date {
  if (!serviceMessageChargingEnabled) return today
  return today > OCT_2026_CUTOVER ? today : OCT_2026_CUTOVER
}

export function resolvePrice(rules: WhatsAppPricingRule[], query: PriceQuery): ResolvedPrice {
  const iso = (query.date ?? new Date()).toISOString().slice(0, 10)

  const candidates = rules.filter(rule =>
    rule.country_code === query.countryCode &&
    rule.category === query.category &&
    rule.is_template === query.isTemplate &&
    rule.in_window === query.inWindow &&
    (rule.entry_point === "any" || rule.entry_point === query.entryPoint) &&
    rule.valid_from <= iso &&
    (!rule.valid_to || rule.valid_to >= iso)
  )

  // Preferir la regla con entry_point exacto sobre "any", y entre empates la de valid_from mas reciente.
  candidates.sort((a, b) => {
    const aExact = a.entry_point === query.entryPoint ? 1 : 0
    const bExact = b.entry_point === query.entryPoint ? 1 : 0
    if (aExact !== bExact) return bExact - aExact
    return b.valid_from.localeCompare(a.valid_from)
  })

  const rule = candidates[0] ?? null
  if (!rule) return { cost: null, currency: null, billable: false, rule: null }

  const billable = rule.cost_amount === null || rule.cost_amount > 0
  return { cost: rule.cost_amount, currency: rule.currency, billable, rule }
}

export async function getPricingRules(): Promise<WhatsAppPricingRule[]> {
  const db = getServiceDb()
  const { data } = await db.from("whatsapp_pricing_rules").select("*")
  return (data ?? []) as WhatsAppPricingRule[]
}

export async function resolvePriceFromDb(
  query: PriceQuery,
  serviceMessageChargingEnabled: boolean
): Promise<ResolvedPrice> {
  const rules = await getPricingRules()
  const date = getEffectivePricingDate(query.date ?? new Date(), serviceMessageChargingEnabled)
  return resolvePrice(rules, { ...query, date })
}
