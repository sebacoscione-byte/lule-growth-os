import { GET } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
import { createClient } from "@/lib/supabase/server"

function mockClient(user: { id: string } | null, leadsResult: { data: unknown; error: { message: string } | null }) {
  const fakeClient = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn().mockResolvedValue(leadsResult),
      })),
    })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(fakeClient)
}

const BASE_LEAD = {
  id: "1",
  name: null,
  phone: "1122334455",
  instagram_username: null,
  origin_channel: "manual",
  requested_service: "no_definido",
  preferred_location: "sin_definir",
  preferred_day: "sin_definir",
  insurance: null,
  status: "nuevo",
  priority_score: 5,
  confirmed_booked: false,
  requires_human: false,
  possible_emergency: false,
  origin_campaign: null,
  utm_source: null,
  utm_medium: null,
  utm_content: null,
  landing_page: null,
  origin_url: null,
  last_message: null,
  ai_summary: null,
  followup_due_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
}

describe("GET /api/leads/export", () => {
  it("devuelve 401 sin sesión", async () => {
    mockClient(null, { data: [], error: null })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("devuelve 500 si Supabase falla", async () => {
    mockClient({ id: "u1" }, { data: null, error: { message: "db down" } })
    const res = await GET()
    expect(res.status).toBe(500)
  })

  it("neutraliza una fórmula maliciosa en el nombre exportado (SEC-02)", async () => {
    mockClient({ id: "u1" }, {
      data: [{ ...BASE_LEAD, name: '=HYPERLINK("http://evil.com")' }],
      error: null,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("'=HYPERLINK")
  })

  it("no antepone comilla a un nombre normal", async () => {
    mockClient({ id: "u1" }, {
      data: [{ ...BASE_LEAD, name: "María José" }],
      error: null,
    })
    const res = await GET()
    const text = await res.text()
    expect(text).toContain("María José")
    expect(text).not.toContain("'María José")
  })
})
