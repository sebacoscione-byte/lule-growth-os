jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))

import { GET, POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

const user = { id: "00000000-0000-4000-8000-000000000001" }

function mockClient() {
  const upsert = jest.fn().mockResolvedValue({ error: null })
  const client = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn().mockResolvedValue({ data: [{ key: "doctor", value: { name: "Dra." } }], error: null }),
      })),
      upsert,
    })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(client)
  return { upsert }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true, user, role: "owner", legacyCompatibility: false, assuranceLevel: "aal2",
  })
  ;(recordSecurityAudit as jest.Mock).mockResolvedValue(undefined)
})

describe("/api/config authorization and audit", () => {
  it("aplica el gate de lectura", async () => {
    mockClient()
    const response = await GET()
    expect(response.status).toBe(200)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
    })
  })

  it("audita antes de escribir configuración", async () => {
    const { upsert } = mockClient()
    const response = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({ key: "doctor", value: { name: "Dra." } }),
    }))
    expect(response.status).toBe(200)
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "config_update",
      actorUserId: user.id,
    }))
    expect(upsert).toHaveBeenCalled()
    expect((recordSecurityAudit as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(upsert.mock.invocationCallOrder[0])
  })

  it("falla cerrado si la auditoría no está disponible", async () => {
    const { upsert } = mockClient()
    ;(recordSecurityAudit as jest.Mock).mockRejectedValue(new Error("db detail"))
    const response = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({ key: "doctor", value: { name: "Dra." } }),
    }))
    expect(response.status).toBe(503)
    expect(upsert).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain("db detail")
  })

  it("normaliza y firma en servidor una configuración canónica de sedes", async () => {
    const { upsert } = mockClient()
    const response = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({
        key: "locations",
        value: [{
          id: "cimel_lanus",
          name: "CIMEL Lanús",
          services: ["Consulta cardiológica"],
          verified_by: "forged-client-value",
        }],
      }),
    }))

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      key: "locations",
      value: [expect.objectContaining({
        id: "cimel_lanus",
        services: ["Consulta cardiológica"],
        active: true,
        verified_at: expect.any(String),
        verified_by: user.id,
        valid_from: expect.any(String),
      })],
    }), { onConflict: "key" })
  })

  it("rechaza escrituras legacy o sedes que el bot no puede enrutar", async () => {
    const { upsert } = mockClient()
    for (const value of [
      [{ id: "cimel_lanus", name: "CIMEL Lanús", practices: ["Consulta"] }],
      [{ id: "sede_inventada", name: "Sede inventada", services: ["Consulta"] }],
    ]) {
      const response = await POST(new Request("http://localhost/api/config", {
        method: "POST",
        body: JSON.stringify({ key: "locations", value }),
      }))
      expect(response.status).toBe(400)
    }
    expect(upsert).not.toHaveBeenCalled()
  })
})
