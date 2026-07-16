jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp-pricing", () => ({
  resolvePriceFromDb: jest.fn().mockResolvedValue({ cost: 0, currency: "ARS", billable: false }),
}))

import { getServiceDb } from "@/lib/supabase/service"
import {
  accountWhatsAppOutboundDelivery,
  hashWhatsAppCostIdentity,
  logWhatsAppMessage,
} from "./whatsapp-cost-tracking"

describe("outbound ledger accounting", () => {
  beforeEach(() => jest.clearAllMocks())

  it("hace upsert idempotente de costo y mensaje usando outbound_ledger_key", async () => {
    const costUpsert = jest.fn().mockResolvedValue({ error: null })
    const messageUpsert = jest.fn().mockResolvedValue({ error: null })
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({
      from: (table: string) => table === "whatsapp_cost_events"
        ? { upsert: costUpsert }
        : { upsert: messageUpsert },
      rpc,
    })

    await logWhatsAppMessage({
      waId: "5491100000000",
      leadId: "lead-1",
      direction: "outbound",
      messageType: "text",
      category: "service",
      isTemplate: false,
      windowState: "open",
      entryPoint: "organic",
      content: "respuesta fija",
      waMessageId: "wamid.outbound",
      outboundLedgerKey: "a".repeat(64),
      serviceMessageChargingEnabled: false,
    })

    expect(costUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        outbound_ledger_key: "a".repeat(64),
        wa_message_id: "wamid.outbound",
        wa_id: hashWhatsAppCostIdentity("5491100000000"),
      }),
      { onConflict: "outbound_ledger_key", ignoreDuplicates: true }
    )
    expect(JSON.stringify(costUpsert.mock.calls)).not.toContain("5491100000000")
    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ outbound_ledger_key: "a".repeat(64), wa_message_id: "wamid.outbound" }),
      { onConflict: "outbound_ledger_key", ignoreDuplicates: true }
    )
    expect(rpc).toHaveBeenCalledWith("reconcile_whatsapp_delivery_status", {
      p_wa_message_id: "wamid.outbound",
    })
  })

  it("delega contador y accounted_at a una única transacción SQL", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await accountWhatsAppOutboundDelivery("a".repeat(64), "5491100000000")
    expect(rpc).toHaveBeenCalledWith("account_whatsapp_outbound_delivery", {
      p_dedupe_key: "a".repeat(64),
      p_phone: "5491100000000",
    })
  })
})
