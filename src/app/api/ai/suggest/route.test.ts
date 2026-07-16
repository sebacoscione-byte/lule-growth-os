jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/ai", () => ({
  generateFollowupSuggestion: jest.fn(),
  getPublicAiError: jest.fn(() => "error de IA"),
}))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))

import { POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { generateFollowupSuggestion } from "@/lib/ai"
import { authorizeStaff } from "@/lib/staff-authz"

function mockSupabase(lead: Record<string, unknown> | null) {
  const single = jest.fn().mockResolvedValue({ data: lead, error: null })
  const from = jest.fn((table: string) => {
    if (table !== "leads") {
      throw new Error(`No se debe consultar la tabla ${table}`)
    }

    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single })),
      })),
    }
  })

  ;(createClient as jest.Mock).mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "staff-1" } } }),
    },
    from,
  })

  return { from }
}

function postRequest(leadId: string) {
  return new Request("http://localhost/api/ai/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lead_id: leadId }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
})

describe("POST /api/ai/suggest", () => {
  it("falla cerrado antes de leer el lead o invocar IA", async () => {
    const { from } = mockSupabase(null)
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      error: "Sin permisos",
    })

    const response = await POST(postRequest("lead-1"))

    expect(response.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
    expect(generateFollowupSuggestion).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor", "reception"],
      sensitive: true,
    })
  })

  it("rechaza leads de WhatsApp antes de leer mensajes o generar texto libre", async () => {
    const { from } = mockSupabase({
      id: "lead-wa",
      name: "Paciente",
      origin_channel: "whatsapp",
      requested_service: "consulta",
      preferred_location: "cimel_lanus",
      status: "nuevo",
    })

    const response = await POST(postRequest("lead-wa"))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/deshabilitadas.*WhatsApp/i),
    })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith("leads")
    expect(generateFollowupSuggestion).not.toHaveBeenCalled()
  })

  it("devuelve 404 para un lead inexistente sin leer mensajes ni invocar la IA", async () => {
    const { from } = mockSupabase(null)

    const response = await POST(postRequest("lead-inexistente"))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Lead no encontrado" })
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith("leads")
    expect(generateFollowupSuggestion).not.toHaveBeenCalled()
  })
})
