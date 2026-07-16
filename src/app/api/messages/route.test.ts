jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp", () => {
  const actual = jest.requireActual("@/lib/whatsapp")
  return { ...actual, sendText: jest.fn() }
})
jest.mock("@/lib/whatsapp-settings", () => ({
  getWhatsAppSettings: jest.fn().mockResolvedValue({ enable_service_message_charging: false }),
}))
jest.mock("@/lib/ai", () => ({
  generateReply: jest.fn(),
  getPublicAiError: jest.fn(() => "error de IA"),
}))
jest.mock("@/lib/whatsapp-handoff", () => ({
  takeHandoffForLead: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/staff-authz", () => ({
  authorizeStaff: jest.fn(async (supabase: { auth: { getUser: () => Promise<{ data: { user: unknown } }> } }) => {
    const { data: { user } } = await supabase.auth.getUser()
    return user
      ? { ok: true, user, role: "owner", legacyCompatibility: true, assuranceLevel: null }
      : { ok: false, status: 401, code: "unauthorized", error: "Unauthorized" }
  }),
}))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn().mockResolvedValue(undefined) }))

import { POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { sendText, WindowClosedError } from "@/lib/whatsapp"
import { generateReply } from "@/lib/ai"
import { takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { recordSecurityAudit } from "@/lib/security-audit"

function messagesTable(opts: { latestMessage?: unknown; historyMessages?: unknown[] } = {}) {
  return {
    insert: jest.fn((row: Record<string, unknown>) => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: { id: "msg-nuevo", ...row }, error: null }),
      })),
    })),
    select: jest.fn((columns: string) => {
      if (columns === "role,content") {
        return {
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue({ data: opts.historyMessages ?? [], error: null }),
            })),
          })),
        }
      }
      return {
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({
                data: opts.latestMessage ?? { id: "msg-enviado", role: "assistant", content: "hola" },
                error: null,
              }),
            })),
          })),
        })),
      }
    }),
  }
}

function leadsTable(lead: Record<string, unknown> | null) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: lead, error: null }) })),
    })),
    update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) })),
  }
}

function mockSupabase(opts: { lead: Record<string, unknown> | null; latestMessage?: unknown; historyMessages?: unknown[] }) {
  const leads = leadsTable(opts.lead)
  const messages = messagesTable({ latestMessage: opts.latestMessage, historyMessages: opts.historyMessages })
  const fromSpy = jest.fn((table: string) => {
    if (table === "leads") return leads
    if (table === "messages") return messages
    throw new Error(`tabla inesperada: ${table}`)
  })
  const client = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "staff-1" } } }) },
    from: fromSpy,
  }
  ;(createClient as jest.Mock).mockResolvedValue(client)
  return { leads, messages }
}

function mockServiceSession(session: Record<string, unknown> | null) {
  const fromSpy = jest.fn((table: string) => {
    if (table === "whatsapp_sessions") {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: session, error: null }) })),
        })),
      }
    }
    throw new Error(`tabla de servicio inesperada: ${table}`)
  })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("POST /api/messages — lead con WhatsApp real conectado", () => {
  const lead = { id: "lead-1", phone: "5491100000000", origin_channel: "whatsapp", name: "Paciente" }
  const deliveryKey = "11111111-1111-4111-8111-111111111111"

  it("manda el mensaje por WhatsApp y toma la conversacion sin reactivar el bot", async () => {
    const { leads, messages } = mockSupabase({ lead, latestMessage: { id: "msg-1", role: "assistant", content: "hola" } })
    mockServiceSession({ last_inbound_at: new Date().toISOString(), entry_point: "organic" })
    ;(sendText as jest.Mock).mockResolvedValue({})

    const res = await POST(postRequest({ lead_id: "lead-1", content: "hola", generate_reply: true, delivery_key: deliveryKey }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assistant_message).toEqual({ id: "msg-1", role: "assistant", content: "hola" })
    expect(sendText).toHaveBeenCalledWith(
      "5491100000000",
      "hola",
      expect.objectContaining({
        windowState: "open",
        leadId: "lead-1",
        deliveryKey: `manual:${deliveryKey}`,
        outboundStep: "manual_response",
      })
    )
    expect(generateReply).not.toHaveBeenCalled()
    // El mensaje ya queda guardado por sendText -> logWhatsAppMessage; la ruta no debe insertarlo de nuevo.
    expect(messages.insert).not.toHaveBeenCalled()
    expect(leads.update).toHaveBeenCalledWith({ last_message: "hola" })
    // Al responder a mano, el bot se pausa para esta conversación (no se pisan entre sí).
    // Ola 4: la respuesta manual real cierra cualquier handoff abierto de este lead (no hay email
    // en el usuario mockeado, así que cae al valor por defecto "equipo").
    expect(takeHandoffForLead).toHaveBeenCalledWith("lead-1", "staff-1")
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "manual_message_send",
      actorUserId: "staff-1",
      resourceId: "lead-1",
    }))
  })

  it("con la ventana de 24h cerrada no manda nada, no pausa el bot, y devuelve un error claro (409)", async () => {
    mockSupabase({ lead })
    mockServiceSession({ last_inbound_at: null, entry_point: "organic" })
    ;(sendText as jest.Mock).mockRejectedValue(new WindowClosedError("5491100000000"))

    const res = await POST(postRequest({ lead_id: "lead-1", content: "hola", delivery_key: deliveryKey }))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/ventana/i)
    expect(takeHandoffForLead).not.toHaveBeenCalled()
  })

  it("un error real de la API de WhatsApp devuelve 500 sin dejarlo pasar en silencio", async () => {
    mockSupabase({ lead })
    mockServiceSession({ last_inbound_at: new Date().toISOString(), entry_point: "organic" })
    ;(sendText as jest.Mock).mockRejectedValue(new Error("WhatsApp API error 401: token vencido"))

    const res = await POST(postRequest({ lead_id: "lead-1", content: "hola", delivery_key: deliveryKey }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/no se pudo confirmar/i)
    expect(body.error).not.toMatch(/token vencido/i)
    // El takeover se persiste antes de llamar a Meta para evitar una carrera con el bot.
    // Si el proveedor falla, la conversación debe seguir pausada para intervención humana.
    expect(takeHandoffForLead).toHaveBeenCalledWith("lead-1", "staff-1")
  })

  it("exige una clave idempotente para cualquier envío manual por WhatsApp", async () => {
    mockSupabase({ lead })
    const res = await POST(postRequest({ lead_id: "lead-1", content: "hola" }))
    expect(res.status).toBe(400)
    expect(sendText).not.toHaveBeenCalled()
  })
})

describe("POST /api/messages — lead sin canal real conectado (Instagram, manual, etc.)", () => {
  const lead = { id: "lead-2", phone: null, origin_channel: "instagram", name: "Ana" }

  it("sigue guardando el mensaje como registro interno, sin llamar a la API de WhatsApp", async () => {
    const { messages } = mockSupabase({ lead })

    const res = await POST(postRequest({ lead_id: "lead-2", content: "hola", generate_reply: false }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_message).toBeDefined()
    expect(sendText).not.toHaveBeenCalled()
    expect(messages.insert).toHaveBeenCalledWith({ lead_id: "lead-2", role: "user", content: "hola" })
  })

  it("con generate_reply, genera una respuesta de IA sin tocar WhatsApp", async () => {
    mockSupabase({ lead, historyMessages: [] })
    ;(generateReply as jest.Mock).mockResolvedValue("respuesta sugerida")

    const res = await POST(postRequest({ lead_id: "lead-2", content: "hola", generate_reply: true }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assistant_message).toBeDefined()
    expect(sendText).not.toHaveBeenCalled()
  })
})
