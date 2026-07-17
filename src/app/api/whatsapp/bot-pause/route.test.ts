jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/whatsapp-handoff", () => ({
  takeHandoffForLead: jest.fn().mockResolvedValue(undefined),
  resolveHandoffForLead: jest.fn().mockResolvedValue({ noticeSent: true, noticeStatus: "sent" }),
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

import { GET, PATCH } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { resolveHandoffForLead, takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

function mockSupabase(user: { id: string; email?: string } | null, lead: Record<string, unknown> | null) {
  const from = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: lead, error: null }) })),
    })),
  }))
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from,
  })
}

function mockServiceSession(session: Record<string, unknown> | null) {
  const from = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: session, error: null }) })),
    })),
  }))
  ;(getServiceDb as jest.Mock).mockReturnValue({ from })
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/whatsapp/bot-pause", {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

beforeEach(() => jest.clearAllMocks())

describe("GET /api/whatsapp/bot-pause", () => {
  it("devuelve 401 sin sesion", async () => {
    mockSupabase(null, null)
    const response = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))
    expect(response.status).toBe(401)
  })

  it("rechaza un lead que no tenga una conversacion de WhatsApp conectada", async () => {
    mockSupabase({ id: "staff-1" }, { phone: null, origin_channel: "instagram" })
    const response = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))
    expect(response.status).toBe(400)
  })

  it("devuelve pausa y estado operativo real", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })
    mockServiceSession({ bot_paused: true, state: "human_active" })

    const response = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ paused: true, state: "human_active" })
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor", "reception"], sensitive: true,
    })
  })
})

describe("PATCH /api/whatsapp/bot-pause", () => {
  it("requiere autenticacion", async () => {
    mockSupabase(null, null)
    const response = await PATCH(patchRequest({ lead_id: "lead-1", paused: true }))
    expect(response.status).toBe(401)
  })

  it("pausar toma el handoff sin escribir directamente un booleano ambiguo", async () => {
    mockSupabase(
      { id: "staff-1", email: "staff@example.com" },
      { phone: "5491100000000", origin_channel: "whatsapp" }
    )

    const response = await PATCH(patchRequest({ lead_id: "lead-1", paused: true }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ paused: true })
    expect(takeHandoffForLead).toHaveBeenCalledWith("lead-1", "staff-1")
    expect(resolveHandoffForLead).not.toHaveBeenCalled()
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bot_pause", actorUserId: "staff-1", resourceId: "lead-1",
    }))
  })

  it("reactivar cierra el handoff mediante la transicion atomica", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })

    const response = await PATCH(patchRequest({ lead_id: "lead-1", paused: false }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      paused: false,
      notice_sent: true,
      notice_status: "sent",
    })
    expect(resolveHandoffForLead).toHaveBeenCalledWith("lead-1", "staff-1")
    expect(takeHandoffForLead).not.toHaveBeenCalled()
  })

  it("rechaza cuerpos invalidos", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })
    const response = await PATCH(patchRequest({ lead_id: "lead-1", paused: "si" }))
    expect(response.status).toBe(400)
    expect(takeHandoffForLead).not.toHaveBeenCalled()
  })
})
