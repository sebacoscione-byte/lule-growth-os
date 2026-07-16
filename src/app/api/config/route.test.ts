jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))

import { GET, POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"

const user = { id: "00000000-0000-4000-8000-000000000001" }

const validLocations = [{
  id: "cimel_lanus",
  name: "CIMEL Lanús",
  practices: ["Consulta cardiológica"],
  active: false,
}]

function mockClient(options: {
  rows?: Array<{ key: string; value: unknown }>
  selectError?: unknown
  upsertError?: unknown
} = {}) {
  const upsert = jest.fn().mockResolvedValue({ error: options.upsertError ?? null })
  const rows = options.rows ?? [
    { key: "doctor", value: { name: "Dra." } },
    { key: "locations", value: validLocations },
  ]
  const client = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn().mockResolvedValue({ data: rows, error: options.selectError ?? null }),
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

describe("GET /api/config", () => {
  it("aplica el gate de lectura y devuelve sedes normalizadas con estado y versión", async () => {
    mockClient()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
    })
    expect(body.locations).toEqual([expect.objectContaining({
      id: "cimel_lanus",
      services: ["Consulta cardiológica"],
      active: false,
    })])
    expect(body.locations[0]).not.toHaveProperty("practices")
    expect(body.locations_status).toEqual(expect.objectContaining({
      valid: true,
      used_legacy_practices: true,
      items: [expect.objectContaining({ id: "cimel_lanus", status: "unverified" })],
    }))
    expect(body.version).toMatch(/^[a-f0-9]{64}$/)
  })

  it("falla cerrado si falta o es inválido el documento de sedes", async () => {
    for (const rows of [
      [{ key: "doctor", value: { name: "Dra." } }],
      [{ key: "locations", value: [{ id: "inventada", name: "No válida" }] }],
    ]) {
      mockClient({ rows })
      const response = await GET()
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual(expect.objectContaining({
        code: "invalid_locations_config",
      }))
    }
  })

  it("redacta el error de base de datos", async () => {
    mockClient({ selectError: new Error("secret db detail") })
    const response = await GET()
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("secret db detail")
  })
})

describe("POST /api/config", () => {
  it("audita antes de escribir configuración no relacionada con sedes", async () => {
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

  it("rechaza cualquier escritura del documento completo de sedes", async () => {
    const { upsert } = mockClient()
    const response = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({
        key: "locations",
        value: [{ id: "cimel_lanus", name: "CIMEL Lanús", services: ["Consulta"] }],
      }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({
      code: "location_route_required",
    }))
    expect(recordSecurityAudit).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("redacta errores de escritura", async () => {
    mockClient({ upsertError: new Error("secret db detail") })
    const response = await POST(new Request("http://localhost/api/config", {
      method: "POST",
      body: JSON.stringify({ key: "doctor", value: { name: "Dra." } }),
    }))
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("secret db detail")
  })
})
