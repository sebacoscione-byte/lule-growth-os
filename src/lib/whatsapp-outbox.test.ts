jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import {
  AmbiguousWhatsAppDeliveryError,
  buildWhatsAppOutboundLedgerIdentity,
  executeWhatsAppOutboundWithLedger,
} from "./whatsapp-outbox"
import { WhatsAppErasureSuppressedError } from "@/lib/whatsapp-erasure-suppression"

const base = {
  sourceKey: "wamid.inbound-sensitive-id",
  destination: "5491100000000",
  flowStep: "consent_request",
  messageType: "interactive_button",
  payload: { messaging_product: "whatsapp", to: "5491100000000", type: "interactive" },
  extractWaMessageId: (result: { messages?: Array<{ id: string }> }) => result.messages?.[0]?.id ?? null,
  classifyFailure: () => "ambiguous" as const,
}

function mockRpc(...responses: Array<{ data: unknown; error: unknown }>) {
  const rpc = jest.fn()
  for (const response of responses) rpc.mockResolvedValueOnce(response)
  ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
  return rpc
}

beforeEach(() => jest.clearAllMocks())

describe("buildWhatsAppOutboundLedgerIdentity", () => {
  it("solo produce hashes y no conserva id entrante, teléfono ni contenido", () => {
    const identity = buildWhatsAppOutboundLedgerIdentity(base)
    expect(identity).not.toBeNull()
    expect(Object.values(identity!)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]))
    expect(JSON.stringify(identity)).not.toContain("wamid.inbound-sensitive-id")
    expect(JSON.stringify(identity)).not.toContain("5491100000000")
  })

  it("mantiene la misma clave si cambia el payload del mismo paso para detectar conflicto", () => {
    const first = buildWhatsAppOutboundLedgerIdentity(base)!
    const changed = buildWhatsAppOutboundLedgerIdentity({ ...base, payload: { text: "copy distinta" } })!
    expect(changed.dedupeKey).toBe(first.dedupeKey)
    expect(changed.payloadHash).not.toBe(first.payloadHash)
  })
})

describe("executeWhatsAppOutboundWithLedger", () => {
  it("rechaza cualquier salida sin identidad durable antes de llamar a Meta", async () => {
    const dispatch = jest.fn()
    await expect(executeWhatsAppOutboundWithLedger({
      ...base,
      sourceKey: null,
      dispatch,
    })).rejects.toThrow("outbound_ledger_identity_required")
    expect(dispatch).not.toHaveBeenCalled()
    expect(getServiceDb).not.toHaveBeenCalled()
  })

  it("reclama antes de Meta y persiste accepted con el wa_message_id", async () => {
    const rpc = mockRpc(
      { data: [{ outcome: "dispatch", wa_message_id: null }], error: null },
      { data: true, error: null },
    )
    const dispatch = jest.fn().mockResolvedValue({ messages: [{ id: "wamid.outbound-1" }] })

    const result = await executeWhatsAppOutboundWithLedger({ ...base, dispatch })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(result.ledgerKey).toMatch(/^[0-9a-f]{64}$/)
    expect(rpc.mock.calls[0][0]).toBe("claim_whatsapp_outbound_intent")
    expect(rpc.mock.calls[1]).toEqual([
      "finalize_whatsapp_outbound_intent",
      expect.objectContaining({ p_outcome: "accepted", p_wa_message_id: "wamid.outbound-1" }),
    ])
  })

  it("un retry accepted reconstruye el resultado sin volver a llamar a Meta", async () => {
    mockRpc({ data: [{ outcome: "accepted", wa_message_id: "wamid.already-accepted" }], error: null })
    const dispatch = jest.fn()
    const result = await executeWhatsAppOutboundWithLedger({ ...base, dispatch })
    expect(dispatch).not.toHaveBeenCalled()
    expect(result.replayedAccepted).toBe(true)
    expect(result.result).toEqual({ messages: [{ id: "wamid.already-accepted" }] })
  })

  it("timeout/red ambigua se congela y el retry nunca reenvía a ciegas", async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ outcome: "dispatch", wa_message_id: null }], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ outcome: "ambiguous", wa_message_id: null }], error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    const dispatch = jest.fn().mockRejectedValue(new TypeError("network timeout"))

    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toBeInstanceOf(AmbiguousWhatsAppDeliveryError)
    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toMatchObject({ code: "delivery_ambiguous" })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("crash lógico tras aceptación pero antes de persistir se vuelve ambiguo y no reenvía", async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: [{ outcome: "dispatch", wa_message_id: null }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "db_down" } })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [{ outcome: "ambiguous", wa_message_id: "wamid.outbound-1" }], error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    const dispatch = jest.fn().mockResolvedValue({ messages: [{ id: "wamid.outbound-1" }] })

    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toMatchObject({ code: "ledger_finalize_failed" })
    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toMatchObject({ code: "delivery_ambiguous" })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("un claim concurrente in_flight no hace un segundo dispatch", async () => {
    mockRpc({ data: [{ outcome: "in_flight", wa_message_id: null }], error: null })
    const dispatch = jest.fn()
    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toMatchObject({ code: "delivery_in_flight" })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("un tombstone concurrente suprime el claim sin crear dispatch", async () => {
    mockRpc({ data: [{ outcome: "suppressed", wa_message_id: null }], error: null })
    const dispatch = jest.fn()
    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toBeInstanceOf(WhatsAppErasureSuppressedError)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("preserva la supresión si el borrado ocurre después del claim y ya no hay ledger para finalizar", async () => {
    const rpc = mockRpc(
      { data: [{ outcome: "dispatch", wa_message_id: null }], error: null },
      { data: false, error: null },
    )
    const dispatch = jest.fn().mockRejectedValue(new WhatsAppErasureSuppressedError())

    await expect(executeWhatsAppOutboundWithLedger({ ...base, dispatch }))
      .rejects.toBeInstanceOf(WhatsAppErasureSuppressedError)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("finalize_whatsapp_outbound_intent", expect.objectContaining({
      p_outcome: "rejected",
      p_error_code: "dispatch_suppressed",
    }))
  })

  it("una toma humana pre-provider sigue suprimida aunque no se pueda finalizar el ledger", async () => {
    mockRpc(
      { data: [{ outcome: "dispatch", wa_message_id: null }], error: null },
      { data: false, error: { code: "row_erased" } },
    )
    const takeover = new Error("automatic_dispatch_suppressed")

    await expect(executeWhatsAppOutboundWithLedger({
      ...base,
      dispatch: jest.fn().mockRejectedValue(takeover),
      classifyFailure: () => "suppressed",
    })).rejects.toBe(takeover)
  })

  it("un rechazo definitivo confirmado queda rejected y conserva el error original", async () => {
    mockRpc(
      { data: [{ outcome: "dispatch", wa_message_id: null }], error: null },
      { data: true, error: null },
    )
    const providerError = new Error("confirmed rejection")
    await expect(executeWhatsAppOutboundWithLedger({
      ...base,
      dispatch: jest.fn().mockRejectedValue(providerError),
      classifyFailure: () => "rejected",
    })).rejects.toBe(providerError)
  })
})
