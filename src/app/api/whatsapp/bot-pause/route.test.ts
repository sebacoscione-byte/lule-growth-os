jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { GET, PATCH } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"

function mockSupabase(user: { id: string } | null, lead: Record<string, unknown> | null) {
  const fromSpy = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: lead, error: null }) })),
    })),
  }))
  const client = { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) }, from: fromSpy }
  ;(createClient as jest.Mock).mockResolvedValue(client)
}

function mockServiceSession(session: Record<string, unknown> | null) {
  const updateSpy = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }))
  const fromSpy = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: session, error: null }) })),
    })),
    update: updateSpy,
  }))
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: fromSpy })
  return { updateSpy }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("GET /api/whatsapp/bot-pause", () => {
  it("devuelve 401 sin sesión", async () => {
    mockSupabase(null, null)
    const res = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))
    expect(res.status).toBe(401)
  })

  it("devuelve 400 si el lead no tiene WhatsApp real conectado", async () => {
    mockSupabase({ id: "staff-1" }, { phone: null, origin_channel: "instagram" })
    const res = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))
    expect(res.status).toBe(400)
  })

  it("devuelve el estado real de la pausa", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })
    mockServiceSession({ bot_paused: true })
    const res = await GET(new Request("http://localhost/api/whatsapp/bot-pause?lead_id=lead-1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paused: true })
  })
})

describe("PATCH /api/whatsapp/bot-pause", () => {
  it("devuelve 401 sin sesión", async () => {
    mockSupabase(null, null)
    const req = new Request("http://localhost/api/whatsapp/bot-pause", {
      method: "PATCH",
      body: JSON.stringify({ lead_id: "lead-1", paused: true }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(401)
  })

  it("pausa/reactiva el bot para el lead", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })
    const { updateSpy } = mockServiceSession({ bot_paused: false })
    const req = new Request("http://localhost/api/whatsapp/bot-pause", {
      method: "PATCH",
      body: JSON.stringify({ lead_id: "lead-1", paused: true }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paused: true })
    expect(updateSpy).toHaveBeenCalledWith({ bot_paused: true })
  })

  it("rechaza con 400 un body inválido", async () => {
    mockSupabase({ id: "staff-1" }, { phone: "5491100000000", origin_channel: "whatsapp" })
    const req = new Request("http://localhost/api/whatsapp/bot-pause", {
      method: "PATCH",
      body: JSON.stringify({ lead_id: "lead-1", paused: "si" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })
})
