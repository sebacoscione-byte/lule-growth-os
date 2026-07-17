jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/alert-email", () => ({
  sendHandoffAlert: jest.fn().mockResolvedValue(undefined),
  sendHandoffReminderAlert: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/whatsapp", () => ({
  sendTemplate: jest.fn().mockResolvedValue({}),
  sendText: jest.fn().mockResolvedValue({}),
}))
jest.mock("@/lib/whatsapp-templates", () => ({ getApprovedTemplate: jest.fn() }))
jest.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppSettings: jest.fn().mockResolvedValue({ enable_service_message_charging: false }),
}))

import {
  buildHandoffSummary,
  BOT_REACTIVATED_NOTICE,
  closeHandoffForLead,
  escalateToHuman,
  formatHandoffAlertText,
  getOpenHandoffs,
  resolveHandoffForLead,
  runHandoffReminderCheck,
  takeHandoffForLead,
} from "@/lib/whatsapp-handoff"
import { getServiceDb } from "@/lib/supabase/service"
import { sendHandoffAlert, sendHandoffReminderAlert } from "@/lib/alert-email"
import { sendTemplate, sendText } from "@/lib/whatsapp"
import { getApprovedTemplate } from "@/lib/whatsapp-templates"
import { getWhatsAppSettings } from "@/lib/whatsapp-settings"

function makeThenableBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "order", "limit", "is", "not", "in", "gte"]) {
    builder[method] = jest.fn(() => builder)
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result))
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

function mockDb(options: {
  handoffEvents?: { data: unknown; error: unknown }
  messages?: { data: unknown; error: unknown }
  session?: { data: unknown; error: unknown }
  rpcError?: unknown
} = {}) {
  const handoffEvents = makeThenableBuilder(
    options.handoffEvents ?? { data: null, error: null }
  )
  const messages = makeThenableBuilder(options.messages ?? { data: [], error: null })
  const session = makeThenableBuilder(options.session ?? {
    data: {
      phone: "5491100000000",
      last_inbound_at: new Date().toISOString(),
      entry_point: "organic",
      bot_paused: true,
      state_version: 7,
    },
    error: null,
  })
  const rpc = jest.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null })
  const from = jest.fn((table: string) => {
    if (table === "handoff_events") return handoffEvents
    if (table === "messages") return messages
    if (table === "whatsapp_sessions") return session
    throw new Error(`tabla inesperada: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from, rpc })
  return { handoffEvents, messages, session, rpc, from }
}

const SUMMARY = buildHandoffSummary({
  phone: "5491100000000",
  lead: {
    id: "lead-1",
    name: "Juana Perez",
    insurance: "OSDE",
    patient_age: 60,
    general_reason: "Turno por dolor",
    possible_emergency: false,
    protocol_interest: false,
    protocol_name: null,
    last_message: "quiero hablar con alguien por mis estudios",
  },
  messagesSentCount: 4,
  costEstimatedTotal: 0,
  nextStepHint: "Retomar contacto",
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(sendText as jest.Mock).mockResolvedValue({})
  ;(getWhatsAppSettings as jest.Mock).mockResolvedValue({ enable_service_message_charging: false })
  delete process.env.ALERT_WHATSAPP_TO
})

describe("escalateToHuman", () => {
  it("crea y pausa el handoff con una unica RPC atomica antes de alertar", async () => {
    const { rpc } = mockDb()

    await escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("create_whatsapp_handoff", {
      p_phone: "5491100000000",
      p_lead_id: "lead-1",
      p_reason: "solicitud_explicita",
      p_summary: SUMMARY,
      p_messages_sent_count: 4,
      p_cost_estimated_total: 0,
      p_source_wa_message_id: null,
    })
    expect(sendHandoffAlert).toHaveBeenCalledTimes(1)
  })

  it("falla cerrado y no emite alertas si la transaccion durable falla", async () => {
    mockDb({ rpcError: { message: "db unavailable" } })

    await expect(
      escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })
    ).rejects.toThrow("No se pudo registrar y pausar la derivación")

    expect(sendHandoffAlert).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it("omite una segunda alerta si ya hubo una para el lead hace menos de 30 minutos", async () => {
    mockDb({
      handoffEvents: {
        data: { created_at: new Date(Date.now() - 5 * 60_000).toISOString() },
        error: null,
      },
    })

    await escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })

    expect(sendHandoffAlert).not.toHaveBeenCalled()
  })

  it("alerta sin PII ni texto clinico y enlaza al inbox autenticado", async () => {
    mockDb()

    await escalateToHuman({ leadId: "lead-1", reason: "urgencia_medica", summary: SUMMARY })

    const [text] = (sendHandoffAlert as jest.Mock).mock.calls[0] as [string]
    expect(text).toContain("Prioridad: Alta")
    expect(text).toContain("caso lead-1")
    expect(text).toContain("/inbox")
    expect(text).not.toContain("?lead_id=")
    for (const sensitive of [
      SUMMARY.nombre,
      SUMMARY.telefono,
      SUMMARY.motivo,
      SUMMARY.cobertura,
      SUMMARY.ultimo_mensaje!,
    ]) {
      expect(text).not.toContain(sensitive)
    }
  })

  it("la alerta interna de WhatsApp usa sólo una referencia seudónima", async () => {
    process.env.ALERT_WHATSAPP_TO = "5491199999999"
    ;(getApprovedTemplate as jest.Mock).mockResolvedValue({
      name: "alerta_interna_derivacion",
      language: "es_AR",
    })
    mockDb()

    await escalateToHuman({ leadId: "lead-1", reason: "solicitud_explicita", summary: SUMMARY })

    expect(sendTemplate).toHaveBeenCalledWith(
      "5491199999999",
      "alerta_interna_derivacion",
      "es_AR",
      [expect.stringMatching(/^CASO-[0-9A-F]{8}$/)],
      expect.objectContaining({ leadId: null })
    )
    const serializedCall = JSON.stringify((sendTemplate as jest.Mock).mock.calls[0])
    expect(serializedCall).not.toContain(SUMMARY.nombre)
    expect(serializedCall).not.toContain(SUMMARY.telefono)
    expect(serializedCall).not.toContain(SUMMARY.ultimo_mensaje)
  })
})

describe("formatHandoffAlertText", () => {
  it("no incorpora ningun dato del resumen por construccion", () => {
    const text = formatHandoffAlertText("solicitud_explicita", "12345678-abcd")
    expect(text).toContain("Referencia: caso 12345678")
    expect(text).toContain("/inbox")
    expect(text).not.toContain("12345678-abcd")
    expect(text).not.toMatch(/54911|OSDE|Juana|estudios/i)
  })
})

describe("transiciones operativas del handoff", () => {
  it.each([
    [takeHandoffForLead, "take"],
    [resolveHandoffForLead, "reactivate"],
    [closeHandoffForLead, "close"],
  ] as const)("usa la RPC atomica para %s", async (operation, action) => {
    const { rpc } = mockDb()
    await operation("lead-1", "staff@example.com")
    expect(rpc).toHaveBeenCalledWith("transition_whatsapp_handoff", {
      p_lead_id: "lead-1",
      p_action: action,
      p_actor: "staff@example.com",
    })
  })

  it("propaga un error de transicion sin simular exito", async () => {
    mockDb({ rpcError: { message: "failed" } })
    await expect(takeHandoffForLead("lead-1", "staff")).rejects.toThrow(
      "No se pudo actualizar la derivación"
    )
  })
})

describe("getOpenHandoffs", () => {
  it("devuelve solo el handoff mas antiguo por lead", async () => {
    mockDb({
      handoffEvents: {
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
    expect(result.get("a")).toEqual({
      createdAt: "2026-07-14T10:00:00.000Z",
      reason: "solicitud_explicita",
      takenAt: null,
      patientRepliedAt: null,
    })
  })

  it("marca una respuesta del paciente solo si es posterior a la ultima salida del equipo", async () => {
    mockDb({
      handoffEvents: {
        data: [{
          lead_id: "a",
          reason: "solicitud_explicita",
          created_at: "2026-07-14T10:00:00.000Z",
          taken_at: "2026-07-14T10:05:00.000Z",
        }],
        error: null,
      },
      messages: {
        data: [
          { lead_id: "a", direction: "inbound", created_at: "2026-07-14T10:10:00.000Z" },
          { lead_id: "a", direction: "outbound", created_at: "2026-07-14T10:07:00.000Z" },
        ],
        error: null,
      },
    })

    const result = await getOpenHandoffs(["a"])

    expect(result.get("a")).toEqual(expect.objectContaining({
      takenAt: "2026-07-14T10:05:00.000Z",
      patientRepliedAt: "2026-07-14T10:10:00.000Z",
    }))
  })

  it("limpia la alerta de respuesta cuando el equipo contesta despues", async () => {
    mockDb({
      handoffEvents: {
        data: [{
          lead_id: "a",
          reason: "solicitud_explicita",
          created_at: "2026-07-14T10:00:00.000Z",
          taken_at: "2026-07-14T10:05:00.000Z",
        }],
        error: null,
      },
      messages: {
        data: [
          { lead_id: "a", direction: "outbound", created_at: "2026-07-14T10:12:00.000Z" },
          { lead_id: "a", direction: "inbound", created_at: "2026-07-14T10:10:00.000Z" },
        ],
        error: null,
      },
    })

    const result = await getOpenHandoffs(["a"])
    expect(result.get("a")?.patientRepliedAt).toBeNull()
  })

  it("reconoce una toma manual aunque no existiera una derivacion previa", async () => {
    mockDb({
      handoffEvents: { data: [], error: null },
      session: {
        data: [{
          lead_id: "a",
          handoff_started_at: "2026-07-14T10:05:00.000Z",
        }],
        error: null,
      },
    })

    const result = await getOpenHandoffs(["a"])

    expect(result.get("a")).toEqual(expect.objectContaining({
      takenAt: "2026-07-14T10:05:00.000Z",
      patientRepliedAt: null,
    }))
  })

  it("no consulta la tabla con un filtro vacio", async () => {
    const result = await getOpenHandoffs([])
    expect(result.size).toBe(0)
    expect(getServiceDb).not.toHaveBeenCalled()
  })
})

describe("aviso al reactivar el bot", () => {
  it("envia un texto fijo administrativo despues de reactivar", async () => {
    mockDb()

    const result = await resolveHandoffForLead("lead-1", "staff-1")

    expect(result).toEqual({ noticeSent: true, noticeStatus: "sent" })
    expect(sendText).toHaveBeenCalledWith(
      "5491100000000",
      BOT_REACTIVATED_NOTICE,
      expect.objectContaining({
        leadId: "lead-1",
        flowIntent: "handoff_reactivated_notice",
        requireActiveBot: true,
        expectedStateVersion: 8,
      })
    )
  })

  it("reactiva igual pero informa si Meta ya cerro la ventana de texto libre", async () => {
    mockDb({
      session: {
        data: {
          phone: "5491100000000",
          last_inbound_at: "2026-07-10T10:00:00.000Z",
          entry_point: "organic",
          bot_paused: true,
          state_version: 7,
        },
        error: null,
      },
    })

    const result = await resolveHandoffForLead("lead-1", "staff-1")

    expect(result).toEqual({ noticeSent: false, noticeStatus: "window_closed" })
    expect(sendText).not.toHaveBeenCalled()
  })

  it("no revierte la reactivacion si Meta no confirma el aviso", async () => {
    mockDb()
    ;(sendText as jest.Mock).mockRejectedValue(new Error("provider unavailable"))

    await expect(resolveHandoffForLead("lead-1", "staff-1")).resolves.toEqual({
      noticeSent: false,
      noticeStatus: "send_failed",
    })
  })
})

describe("runHandoffReminderCheck", () => {
  it("no alerta si no hay handoffs vencidos", async () => {
    mockDb({
      handoffEvents: {
        data: [{ lead_id: "a", reason: "solicitud_explicita", created_at: "2026-07-14T11:45:00.000Z" }],
        error: null,
      },
    })

    await expect(runHandoffReminderCheck(new Date("2026-07-14T12:00:00.000Z"))).resolves.toEqual({ pending: 0 })
    expect(sendHandoffReminderAlert).not.toHaveBeenCalled()
  })

  it("no sigue avisando que espera una persona despues de que el equipo lo tomo", async () => {
    mockDb({
      handoffEvents: {
        data: [{
          lead_id: "a",
          reason: "solicitud_explicita",
          created_at: "2026-07-14T05:00:00.000Z",
          taken_at: "2026-07-14T05:10:00.000Z",
        }],
        error: null,
      },
    })

    await expect(runHandoffReminderCheck(new Date("2026-07-14T12:00:00.000Z"))).resolves.toEqual({ pending: 0 })
    expect(sendHandoffReminderAlert).not.toHaveBeenCalled()
  })

  it("manda referencias e inbox, nunca telefono, nombre ni ultimo mensaje", async () => {
    mockDb({
      handoffEvents: {
        data: [{ lead_id: "lead-123456", reason: "solicitud_explicita", created_at: "2026-07-14T05:30:00.000Z" }],
        error: null,
      },
    })

    await expect(runHandoffReminderCheck(new Date("2026-07-14T12:00:00.000Z"))).resolves.toEqual({ pending: 1 })
    const [text] = (sendHandoffReminderAlert as jest.Mock).mock.calls[0] as [string]
    expect(text).toContain("Caso lead-123")
    expect(text).toContain("/inbox?lead_id=lead-123456")
    expect(text).not.toMatch(/5491100000000|Juana|OSDE|estudios/i)
  })

  it("devuelve el error sin tumbar el cron", async () => {
    ;(getServiceDb as jest.Mock).mockImplementation(() => { throw new Error("conexion caida") })
    const result = await runHandoffReminderCheck(new Date())
    expect(result).toEqual({ pending: 0, error: "handoff_reminder_failed" })
  })
})

describe("buildHandoffSummary", () => {
  it("conserva el resumen completo solo para el registro interno durable", () => {
    expect(SUMMARY).toEqual(expect.objectContaining({
      nombre: "Juana Perez",
      telefono: "5491100000000",
      cobertura: "OSDE",
      edad: 60,
      ultimo_mensaje: "quiero hablar con alguien por mis estudios",
    }))
  })
})
