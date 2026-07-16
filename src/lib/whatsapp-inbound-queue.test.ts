jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp-bot", () => ({ handleIncomingMessage: jest.fn() }))
jest.mock("@/lib/whatsapp-erasure-suppression", () => ({
  assertWhatsAppErasureNotSuppressed: jest.fn().mockResolvedValue(undefined),
  WhatsAppErasureSuppressedError: class WhatsAppErasureSuppressedError extends Error {},
}))

import {
  applyWhatsAppDeliveryStatus,
  PermanentWhatsAppQueueError,
  calculateWhatsAppRetryDelaySeconds,
  enqueueWhatsAppEvents,
  getWhatsAppQueueHealth,
  claimWhatsAppDeadLetterAlerts,
  finalizeWhatsAppDeadLetterAlert,
  drainWhatsAppInboundQueue,
  isPermanentWhatsAppQueueError,
  processClaimedWhatsAppEvent,
  quarantineAmbiguousOutbound,
  sanitizeWhatsAppQueueError,
  type ClaimedWhatsAppEvent,
} from "./whatsapp-inbound-queue"
import {
  WhatsAppApiError,
  WhatsAppAutomaticDispatchSuppressedError,
  WhatsAppConfigurationError,
  WindowClosedError,
} from "./whatsapp"
import { getServiceDb } from "@/lib/supabase/service"
import { AmbiguousWhatsAppDeliveryError } from "./whatsapp-outbox"
import { handleIncomingMessage } from "@/lib/whatsapp-bot"
import {
  assertWhatsAppErasureNotSuppressed,
  WhatsAppErasureSuppressedError,
} from "@/lib/whatsapp-erasure-suppression"

function event(overrides: Partial<ClaimedWhatsAppEvent> = {}): ClaimedWhatsAppEvent {
  return {
    id: "event-1",
    wa_message_id: "wamid.1",
    event_type: "inbound",
    related_wa_message_id: "wamid.1",
    phone: "5491100000000",
    phone_hash: "a".repeat(64),
    message_type: "text",
    message_text: "Hola",
    wa_name: "Juana",
    button_id: null,
    referral: null,
    delivery_status: null,
    status_error_code: null,
    occurred_at: "2026-07-16T00:00:00.000Z",
    batch_order: 0,
    attempts: 1,
    handler_completed_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  ;(assertWhatsAppErasureNotSuppressed as jest.Mock).mockReset().mockResolvedValue(undefined)
})

describe("processClaimedWhatsAppEvent", () => {
  it("procesa el inbound conservando el tipo real sin emitir un read receipt no ledgerizado", async () => {
    const markRead = jest.fn().mockResolvedValue(undefined)
    const handleIncoming = jest.fn().mockResolvedValue(undefined)
    const applyStatus = jest.fn().mockResolvedValue(undefined)
    const audio = event({ message_type: "audio", message_text: "" })

    await processClaimedWhatsAppEvent(audio, { markRead, handleIncoming, applyStatus })

    expect(markRead).not.toHaveBeenCalled()
    expect(handleIncoming).toHaveBeenCalledWith(expect.objectContaining({
      phone: "5491100000000",
      messageType: "audio",
      text: "",
      waMessageId: "wamid.1",
    }))
    expect(applyStatus).not.toHaveBeenCalled()
  })

  it("no intenta el read receipt cosmético aunque exista un adaptador", async () => {
    const markRead = jest.fn().mockRejectedValue(new Error("Meta unavailable"))
    const handleIncoming = jest.fn().mockResolvedValue(undefined)
    await processClaimedWhatsAppEvent(event(), {
      markRead,
      handleIncoming,
      applyStatus: jest.fn(),
    })
    expect(markRead).not.toHaveBeenCalled()
    expect(handleIncoming).toHaveBeenCalledTimes(1)
  })

  it("aplica un status sin disparar bot ni read receipt", async () => {
    const markRead = jest.fn()
    const handleIncoming = jest.fn()
    const applyStatus = jest.fn().mockResolvedValue(undefined)
    const status = event({
      event_type: "status",
      message_type: null,
      phone: null,
      delivery_status: "delivered",
    })

    await processClaimedWhatsAppEvent(status, { markRead, handleIncoming, applyStatus })
    expect(applyStatus).toHaveBeenCalledWith(status)
    expect(markRead).not.toHaveBeenCalled()
    expect(handleIncoming).not.toHaveBeenCalled()
  })

  it("verifica tanto la clave sintética como el provider id antes de aplicar un status", async () => {
    const status = event({
      wa_message_id: "status.synthetic-key",
      related_wa_message_id: "wamid.erased-outbound",
      event_type: "status",
      message_type: null,
      delivery_status: "delivered",
    })
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await processClaimedWhatsAppEvent(status)

    expect(assertWhatsAppErasureNotSuppressed).toHaveBeenNthCalledWith(
      1, status.phone, "status.synthetic-key", status.occurred_at
    )
    expect(assertWhatsAppErasureNotSuppressed).toHaveBeenNthCalledWith(
      2, status.phone, "wamid.erased-outbound", status.occurred_at
    )
  })

  it("manda un envelope inbound corrupto a DLQ en vez de invocar al bot", async () => {
    const dependencies = {
      markRead: jest.fn(),
      handleIncoming: jest.fn(),
      applyStatus: jest.fn(),
    }
    await expect(processClaimedWhatsAppEvent(event({ phone: null }), dependencies))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_inbound_envelope" }))
    expect(dependencies.handleIncoming).not.toHaveBeenCalled()
  })
})

describe("enqueueWhatsAppEvents", () => {
  it("usa wa_message_id como clave idempotente y estado pending", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn().mockReturnValue({ upsert }) })
    await enqueueWhatsAppEvents([{
      event_key: "wamid.1",
      event_type: "inbound",
      related_wa_message_id: "wamid.1",
      phone: "5491100000000",
      phone_hash: "a".repeat(64),
      message_type: "audio",
      message_text: "",
      wa_name: null,
      button_id: null,
      referral: null,
      delivery_status: null,
      status_error_code: null,
      occurred_at: null,
      batch_order: 0,
      phone_number_id: "123456789",
    }])
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ wa_message_id: "wamid.1", status: "pending", message_type: "audio" })],
      { onConflict: "wa_message_id", ignoreDuplicates: true }
    )
  })
})

describe("salud y alertas de la cola", () => {
  it("consulta únicamente conteos y no columnas con PII", async () => {
    const builders: Array<Record<string, jest.Mock>> = []
    const from = jest.fn(() => {
      const result = builders.length === 0
        ? { count: 2, error: null }
        : { count: 3, error: null }
      const builder: Record<string, jest.Mock> = {}
      builder.select = jest.fn(() => builder)
      builder.eq = jest.fn(() => Promise.resolve(result))
      builder.in = jest.fn(() => builder)
      builder.lte = jest.fn(() => Promise.resolve(result))
      builders.push(builder)
      return builder
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from })

    await expect(getWhatsAppQueueHealth(new Date("2026-07-16T12:00:00.000Z")))
      .resolves.toEqual({ deadLetterCount: 2, dueCount: 3 })
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true })
      expect(JSON.stringify(builder.select.mock.calls)).not.toMatch(/phone|message_text|wa_name/)
    }
  })

  it("reclama alertas DLQ por conteo cerrado", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ claim_token: "11111111-1111-4111-8111-111111111111", event_count: 4 }],
      error: null,
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await expect(claimWhatsAppDeadLetterAlerts()).resolves.toEqual({
      claimToken: "11111111-1111-4111-8111-111111111111",
      eventCount: 4,
    })
    expect(rpc).toHaveBeenCalledWith("claim_whatsapp_dead_letter_alerts")
  })

  it("confirma la alerta DLQ separadamente y conserva el resultado del proveedor", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 4, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await finalizeWhatsAppDeadLetterAlert("11111111-1111-4111-8111-111111111111", false)
    expect(rpc).toHaveBeenCalledWith("finalize_whatsapp_dead_letter_alert", {
      p_claim_token: "11111111-1111-4111-8111-111111111111",
      p_delivered: false,
    })
  })

  it("respeta el presupuesto temporal antes de reclamar otro evento", async () => {
    const now = jest.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(50_000)
    const rpc = jest.fn().mockResolvedValue({ data: 0, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await expect(drainWhatsAppInboundQueue({
      maxEvents: 50,
      workerId: "worker-test",
      timeBudgetMs: 40_000,
    })).resolves.toEqual({ claimed: 0, processed: 0, retried: 0, deadLettered: 0 })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith("recover_stale_whatsapp_outbound_intents")
    expect(rpc).toHaveBeenCalledWith("recover_stale_whatsapp_followups")
    now.mockRestore()
  })

  it("checkpoint durable evita reejecutar el handler si falla solamente el cierre", async () => {
    ;(handleIncomingMessage as jest.Mock).mockClear().mockResolvedValue(undefined)
    let claimCount = 0
    let completeCount = 0
    const rpc = jest.fn((name: string) => {
      if (name === "recover_stale_whatsapp_outbound_intents" || name === "recover_stale_whatsapp_followups") {
        return Promise.resolve({ data: 0, error: null })
      }
      if (name === "claim_whatsapp_webhook_event") {
        claimCount += 1
        return Promise.resolve({
          data: claimCount === 1
            ? event()
            : event({
                attempts: 5,
                handler_completed_at: "2026-07-16T00:00:01.000Z",
                phone: null,
                message_type: null,
                message_text: null,
              }),
          error: null,
        })
      }
      if (name === "checkpoint_whatsapp_webhook_handler") {
        return Promise.resolve({ data: true, error: null })
      }
      if (name === "complete_whatsapp_webhook_event") {
        completeCount += 1
        return completeCount === 1
          ? Promise.resolve({ data: null, error: { code: "temporary" } })
          : Promise.resolve({ data: true, error: null })
      }
      if (name === "fail_whatsapp_webhook_event") {
        return Promise.resolve({ data: "retry", error: null })
      }
      throw new Error(`rpc inesperada: ${name}`)
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await expect(drainWhatsAppInboundQueue({ maxEvents: 2, workerId: "worker-checkpoint" }))
      .resolves.toEqual({ claimed: 2, processed: 1, retried: 1, deadLettered: 0 })

    expect(handleIncomingMessage).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls.filter(([name]) => name === "checkpoint_whatsapp_webhook_handler")).toHaveLength(1)
    expect(rpc.mock.calls.filter(([name]) => name === "complete_whatsapp_webhook_event")).toHaveLength(2)
  })

  it("recupera followups estancados en cada ciclo sin bloquear la cola si el RPC falla", async () => {
    const rpc = jest.fn((name: string) => {
      if (name === "recover_stale_whatsapp_outbound_intents") return Promise.resolve({ data: 0, error: null })
      if (name === "recover_stale_whatsapp_followups") return Promise.resolve({ data: null, error: { code: "temporary" } })
      if (name === "claim_whatsapp_webhook_event") return Promise.resolve({ data: null, error: null })
      throw new Error(`rpc inesperada: ${name}`)
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await expect(drainWhatsAppInboundQueue({ maxEvents: 1, workerId: "worker-recovery" }))
      .resolves.toEqual({ claimed: 0, processed: 0, retried: 0, deadLettered: 0 })
    expect(rpc).toHaveBeenCalledWith("recover_stale_whatsapp_followups")
  })

  it("cierra como procesado un despacho automático suprimido por takeover humano", async () => {
    ;(handleIncomingMessage as jest.Mock).mockClear()
      .mockRejectedValueOnce(new WhatsAppAutomaticDispatchSuppressedError())
    let claimCount = 0
    const rpc = jest.fn((name: string) => {
      if (name === "recover_stale_whatsapp_outbound_intents" || name === "recover_stale_whatsapp_followups") {
        return Promise.resolve({ data: 0, error: null })
      }
      if (name === "claim_whatsapp_webhook_event") {
        claimCount += 1
        return Promise.resolve({ data: claimCount === 1 ? event() : null, error: null })
      }
      if (name === "checkpoint_whatsapp_webhook_handler" || name === "complete_whatsapp_webhook_event") {
        return Promise.resolve({ data: true, error: null })
      }
      if (name === "fail_whatsapp_webhook_event") {
        throw new Error("no debe reintentar ni enviar a DLQ")
      }
      throw new Error(`rpc inesperada: ${name}`)
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await expect(drainWhatsAppInboundQueue({ maxEvents: 1, workerId: "worker-human-takeover" }))
      .resolves.toEqual({ claimed: 1, processed: 1, retried: 0, deadLettered: 0 })
    expect(rpc).toHaveBeenCalledWith("checkpoint_whatsapp_webhook_handler", {
      p_event_id: "event-1",
      p_worker_id: "worker-human-takeover",
    })
    expect(rpc).toHaveBeenCalledWith("complete_whatsapp_webhook_event", {
      p_event_id: "event-1",
      p_worker_id: "worker-human-takeover",
    })
    expect(rpc).not.toHaveBeenCalledWith("fail_whatsapp_webhook_event", expect.anything())
  })

  it("elimina la fila reclamada sin handler ni DLQ si existe tombstone de borrado", async () => {
    ;(handleIncomingMessage as jest.Mock).mockClear()
    ;(assertWhatsAppErasureNotSuppressed as jest.Mock)
      .mockRejectedValueOnce(new WhatsAppErasureSuppressedError())
    const rpc = jest.fn((name: string) => {
      if (name === "recover_stale_whatsapp_outbound_intents" || name === "recover_stale_whatsapp_followups") {
        return Promise.resolve({ data: 0, error: null })
      }
      if (name === "claim_whatsapp_webhook_event") return Promise.resolve({ data: event(), error: null })
      if (name === "complete_erased_whatsapp_webhook_event") {
        return Promise.resolve({ data: true, error: null })
      }
      if (name === "fail_whatsapp_webhook_event" || name === "checkpoint_whatsapp_webhook_handler") {
        throw new Error("no debe persistir ni reintentar un evento borrado")
      }
      throw new Error(`rpc inesperada: ${name}`)
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })

    await expect(drainWhatsAppInboundQueue({ maxEvents: 1, workerId: "worker-erasure" }))
      .resolves.toEqual({ claimed: 1, processed: 1, retried: 0, deadLettered: 0 })
    expect(handleIncomingMessage).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("complete_erased_whatsapp_webhook_event", {
      p_event_id: "event-1",
      p_worker_id: "worker-erasure",
      p_source_key: "wamid.1",
      p_related_source_key: "wamid.1",
    })
  })
})

describe("applyWhatsAppDeliveryStatus", () => {
  it("delega la transición al RPC atómico con id, timestamp y código técnico", async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await applyWhatsAppDeliveryStatus(event({
      event_type: "status",
      message_type: null,
      delivery_status: "failed",
      status_error_code: "131026",
    }))
    expect(rpc).toHaveBeenCalledWith("apply_whatsapp_delivery_status", {
      p_wa_message_id: "wamid.1",
      p_status: "failed",
      p_occurred_at: "2026-07-16T00:00:00.000Z",
      p_error_code: "131026",
    })
    expect(rpc).toHaveBeenCalledWith("reconcile_whatsapp_outbound_acceptance", {
      p_wa_message_id: "wamid.1",
    })
  })
})

describe("quarantineAmbiguousOutbound", () => {
  it("pausa mediante RPC durable sin enviar texto ni guardar el mensaje del paciente", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await quarantineAmbiguousOutbound(
      event(),
      new AmbiguousWhatsAppDeliveryError("a".repeat(64), "delivery_ambiguous")
    )
    expect(rpc).toHaveBeenCalledWith("quarantine_whatsapp_ambiguous_delivery", {
      p_phone: "5491100000000",
      p_dedupe_key: "a".repeat(64),
      p_error_code: "delivery_ambiguous",
    })
  })
})

describe("retry y errores sanitizados", () => {
  it("calcula backoff exponencial acotado", () => {
    expect([1, 2, 3, 4, 5].map(calculateWhatsAppRetryDelaySeconds)).toEqual([5, 10, 20, 40, 80])
    expect(calculateWhatsAppRetryDelaySeconds(20)).toBe(900)
  })

  it("no copia mensajes arbitrarios ni cuerpos del proveedor", () => {
    expect(sanitizeWhatsAppQueueError(new Error("token=secret telefono=54911"))).toBe("internal_error")
    expect(sanitizeWhatsAppQueueError(new WhatsAppApiError(400, "131026", false))).toBe("meta_api_400_131026")
    expect(sanitizeWhatsAppQueueError(new WhatsAppConfigurationError("invalid_graph_api_version")))
      .toBe("invalid_graph_api_version")
    expect(sanitizeWhatsAppQueueError(new PermanentWhatsAppQueueError("invalid_event"))).toBe("invalid_event")
    expect(sanitizeWhatsAppQueueError(new AmbiguousWhatsAppDeliveryError("a".repeat(64), "delivery_ambiguous")))
      .toBe("delivery_ambiguous")
  })

  it("solo clasifica como definitivos guardas o 4xx no transitorios", () => {
    expect(isPermanentWhatsAppQueueError(new WindowClosedError("5491100000000"))).toBe(true)
    expect(isPermanentWhatsAppQueueError(new WhatsAppApiError(400, 100, false))).toBe(true)
    expect(isPermanentWhatsAppQueueError(new WhatsAppConfigurationError("invalid_graph_api_version"))).toBe(true)
    expect(isPermanentWhatsAppQueueError(new WhatsAppApiError(429, 4, true))).toBe(false)
    expect(isPermanentWhatsAppQueueError(new Error("network"))).toBe(false)
    expect(isPermanentWhatsAppQueueError(
      new AmbiguousWhatsAppDeliveryError("a".repeat(64), "delivery_in_flight")
    )).toBe(true)
  })
})
