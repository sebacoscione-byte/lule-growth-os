import { GET } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({
  authorizeStaff: jest.fn(async (supabase: { auth: { getUser: () => Promise<{ data: { user: unknown } }> } }) => {
    const { data: { user } } = await supabase.auth.getUser()
    return user
      ? { ok: true, user, role: "owner", legacyCompatibility: true, assuranceLevel: null }
      : { ok: false, status: 401, code: "unauthorized", error: "Unauthorized" }
  }),
}))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn().mockResolvedValue(undefined) }))
import { createClient } from "@/lib/supabase/server"
import { recordSecurityAudit } from "@/lib/security-audit"

function mockClient(user: { id: string } | null, leadsResult: { data: unknown; error: { message: string } | null }) {
  const fakeClient = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(() => ({
          range: jest.fn().mockResolvedValue(leadsResult),
        })),
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
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "lead_export", actorUserId: "u1",
    }))
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

  it("PERF-01: pagina con range() hasta agotar los resultados en vez de truncar en silencio", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ ...BASE_LEAD, id: `page1-${i}` }))
    const secondPage = [{ ...BASE_LEAD, id: "page2-0" }]
    const rangeSpy = jest.fn()
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null })
    const fakeClient = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          order: jest.fn(() => ({ range: rangeSpy })),
        })),
      })),
    }
    ;(createClient as jest.Mock).mockResolvedValue(fakeClient)

    const res = await GET()
    expect(res.status).toBe(200)
    expect(rangeSpy).toHaveBeenCalledTimes(2)
    expect(rangeSpy).toHaveBeenNthCalledWith(1, 0, 999)
    expect(rangeSpy).toHaveBeenNthCalledWith(2, 1000, 1999)
    const text = await res.text()
    expect(text).toContain("page1-0")
    expect(text).toContain("page2-0")
  })
})
