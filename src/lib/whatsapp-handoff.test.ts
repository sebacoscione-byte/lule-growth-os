jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/alert-email", () => ({
  sendHandoffAlert: jest.fn().mockResolvedValue(undefined),
  sendHandoffReminderAlert: jest.fn().mockResolvedValue(undefined),
}))

import {
  buildHandoffSummary, escalateToHuman, resolveHandoffForLead, getOpenHandoffs, runHandoffReminderCheck,
} from "@/lib/whatsapp-handoff"
import { getServiceDb } from "@/lib/supabase/service"
import { sendHandoffAlert, sendHandoffReminderAlert } from "@/lib/alert-email"

/** Chainable mínimo: cualquier método de la cadena devuelve el mismo builder, y tanto
 * `.single()/.maybeSingle()` como awaitear el builder directo resuelven al mismo resultado
 * -- mismo patrón que whatsapp-bot-pause.test.ts. */
function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = ["select", "eq", "order", "limit", "insert", "update", "is", "not", "in"]
  for (const method of chain) builder[method] = jest.fn(() => builder)
  builder.single = jest.fn(() => Promise.resolve(result))
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(tables: Record<string, { data: unknown; error: unknown }>) {
  const builders = Object.fromEntries(
    Object.entries(tables).map(([table, result]) => [table, makeThenableBuilder(result)])
  )
  const fromSpy = jest.fn((table: string) => {
    if (!builders[table]) throw new Error(`tabla inesperada en el mock: ${table}`)
    return builders[table]
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
  return builders
}

const SUMMARY = buildHandoffSummary({
  phone: "5491100000000",
  lead: { id: "lead-1", name: "Juana Pérez", insurance: "OSDE", patient_age: 60, general_reason: "Turno", possible_emergency: false, protocol_interest: false, protocol_name: null, last_message: "quiero hablar con alguien" },
  messagesSentCount: 4,
  costEstimatedTotal: 0,
  nextStepHint: "Retomar contacto",
})

describe("escalateToHuman", () => {
  beforeEach(() => jest.clearAllMocks())

  it("inserta el handoff, marca requires_human y manda una alerta cuando no hubo un handoff reciente", async () => {
    const builders = mockDb({
      handoff_events: { data: null, error: null }, // sin handoff previo reciente
      leads: { data: null, error: null },
    })

    await escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })

    expect(builders.handoff_events.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: "lead-1", reason: "solicitud_explicita" })
    )
    expect(builders.leads.update).toHaveBeenCalledWith(
      expect.objectContaining({ requires_human: true })
    )
    expect(sendHandoffAlert).toHaveBeenCalledTimes(1)
    const [text] = (sendHandoffAlert as jest.Mock).mock.calls[0]
    expect(text).toContain("Juana Pérez")
    expect(text).toContain("/inbox?lead_id=lead-1")
  })

  it("no manda una segunda alerta si el último handoff del mismo lead fue hace menos de 30 minutos", async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    mockDb({
      handoff_events: { data: { created_at: fiveMinAgo }, error: null },
      leads: { data: null, error: null },
    })

    await escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })

    expect(sendHandoffAlert).not.toHaveBeenCalled()
  })

  it("sí manda alerta si el último handoff del mismo lead fue hace más de 30 minutos", async () => {
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60_000).toISOString()
    mockDb({
      handoff_events: { data: { created_at: fortyFiveMinAgo }, error: null },
      leads: { data: null, error: null },
    })

    await escalateToHuman({ leadId: "lead-1", reason: "urgencia_medica", summary: SUMMARY })

    expect(sendHandoffAlert).toHaveBeenCalledTimes(1)
  })

  it("sin leadId (todavía no hay lead creado) igual manda la alerta, sin chequear throttle", async () => {
    const builders = mockDb({ handoff_events: { data: null, error: null } })

    await escalateToHuman({ leadId: null, reason: "urgencia_medica", summary: SUMMARY })

    expect(builders.handoff_events.select).not.toHaveBeenCalled() // no hay leadId, no hay nada que throttlear
    expect(sendHandoffAlert).toHaveBeenCalledTimes(1)
  })
})

describe("resolveHandoffForLead", () => {
  beforeEach(() => jest.clearAllMocks())

  it("marca resuelto el handoff abierto del lead y limpia requires_human", async () => {
    const builders = mockDb({
      handoff_events: { data: null, error: null },
      leads: { data: null, error: null },
    })

    await resolveHandoffForLead("lead-1", "seba@example.com")

    expect(builders.handoff_events.update).toHaveBeenCalledWith(
      expect.objectContaining({ resolved_by: "seba@example.com" })
    )
    expect(builders.handoff_events.eq).toHaveBeenCalledWith("lead_id", "lead-1")
    expect(builders.handoff_events.is).toHaveBeenCalledWith("resolved_at", null)
    expect(builders.leads.update).toHaveBeenCalledWith({ requires_human: false })
  })
})

describe("getOpenHandoffs", () => {
  beforeEach(() => jest.clearAllMocks())

  it("devuelve el handoff más antiguo por lead, sin duplicar leads con más de un evento abierto", async () => {
    mockDb({
      handoff_events: {
        data: [
          { lead_id: "a", reason: "solicitud_explicita", created_at: "2026-07-14T10:00:00.000Z" },
          { lead_id: "a", reason: "conversacion_larga", created_at: "2026-07-14T11:00:00.000Z" },
          { lead_id: "b", reason: "urgencia_medica", created_at: "2026-07-14T09:00:00.000Z" },
        ],
        error: null,
      },
    })

    const result = await getOpenHandoffs()

    expect(result.size).toBe(2)
    expect(result.get("a")).toEqual({ createdAt: "2026-07-14T10:00:00.000Z", reason: "solicitud_explicita" })
    expect(result.get("b")?.reason).toBe("urgencia_medica")
  })

  it("con un array de leadIds vacío, devuelve un Map vacío sin consultar la base", async () => {
    mockDb({})

    const result = await getOpenHandoffs([])

    expect(result.size).toBe(0)
    expect(getServiceDb).not.toHaveBeenCalled()
  })
})

describe("runHandoffReminderCheck", () => {
  beforeEach(() => jest.clearAllMocks())

  it("no manda nada si ningún handoff abierto lleva más de 60 minutos esperando", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z")
    mockDb({
      handoff_events: {
        data: [{ lead_id: "a", reason: "solicitud_explicita", created_at: "2026-07-14T11:45:00.000Z" }],
        error: null,
      },
    })

    const result = await runHandoffReminderCheck(now)

    expect(result).toEqual({ pending: 0 })
    expect(sendHandoffReminderAlert).not.toHaveBeenCalled()
  })

  it("manda un único mail con los handoffs abiertos hace más de 60 minutos", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z")
    const builders = mockDb({
      handoff_events: {
        data: [{ lead_id: "lead-1", reason: "solicitud_explicita", created_at: "2026-07-14T05:30:00.000Z" }],
        error: null,
      },
      leads: { data: [{ id: "lead-1", name: "Juana Pérez", phone: "5491100000000" }], error: null },
    })

    const result = await runHandoffReminderCheck(now)

    expect(result).toEqual({ pending: 1 })
    expect(builders.leads.in).toHaveBeenCalledWith("id", ["lead-1"])
    expect(sendHandoffReminderAlert).toHaveBeenCalledTimes(1)
    const [text] = (sendHandoffReminderAlert as jest.Mock).mock.calls[0]
    expect(text).toContain("Juana Pérez")
    expect(text).toContain("5491100000000")
  })

  it("si falla la consulta, devuelve el error en vez de lanzar (no debe tumbar el cron)", async () => {
    ;(getServiceDb as jest.Mock).mockImplementation(() => { throw new Error("conexión caída") })

    const result = await runHandoffReminderCheck(new Date())

    expect(result.pending).toBe(0)
    expect(result.error).toBe("conexión caída")
    expect(sendHandoffReminderAlert).not.toHaveBeenCalled()
  })
})

describe("buildHandoffSummary", () => {
  it("arma un resumen compacto a partir del lead y la conversacion", () => {
    const summary = buildHandoffSummary({
      phone: "5491100000000",
      lead: {
        id: "lead-1",
        name: "Juana Pérez",
        insurance: "OSDE",
        patient_age: 52,
        general_reason: "Dolor precordial ocasional",
        possible_emergency: false,
        protocol_interest: true,
        protocol_name: "Estudio arritmias 2026",
        last_message: "Quiero saber si aplico al protocolo",
      },
      messagesSentCount: 6,
      costEstimatedTotal: 0,
      nextStepHint: "Contactar para evaluar elegibilidad de protocolo",
    })

    expect(summary.nombre).toBe("Juana Pérez")
    expect(summary.cobertura).toBe("OSDE")
    expect(summary.edad).toBe(52)
    expect(summary.urgencia).toBe("No urgente")
    expect(summary.protocolo_posible).toBe("Estudio arritmias 2026")
    expect(summary.mensajes_enviados).toBe(6)
  })

  it("usa valores por defecto cuando todavia no hay lead creado", () => {
    const summary = buildHandoffSummary({
      phone: "5491100000000",
      lead: null,
      messagesSentCount: 1,
      costEstimatedTotal: null,
      nextStepHint: "Contactar apenas se pueda",
    })

    expect(summary.nombre).toBe("Sin nombre")
    expect(summary.cobertura).toBe("No informada")
    expect(summary.urgencia).toBe("No urgente")
    expect(summary.protocolo_posible).toBe("No")
  })
})
