jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))

import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"
import { DEFAULT_PLANNING_CONFIG } from "@/lib/practice-planning"
import { GET, PUT } from "./route"

const user = { id: "00000000-0000-4000-8000-000000000001" }

function mockClient(options: { readError?: unknown; writeError?: unknown; config?: unknown } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options.readError ? null : {
      config: options.config ?? DEFAULT_PLANNING_CONFIG,
      updated_at: "2026-08-05T21:00:00.000Z",
    },
    error: options.readError ?? null,
  })
  const single = jest.fn().mockResolvedValue({
    data: options.writeError ? null : { updated_at: "2026-08-05T22:00:00.000Z" },
    error: options.writeError ?? null,
  })
  const selectAfterWrite = jest.fn(() => ({ single }))
  const upsert = jest.fn(() => ({ select: selectAfterWrite }))
  const from = jest.fn(() => ({
    select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
    upsert,
  }))
  ;(createClient as jest.Mock).mockResolvedValue({ from })
  return { from, upsert }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true,
    user,
    role: "owner",
    legacyCompatibility: false,
    assuranceLevel: "aal2",
  })
  ;(recordSecurityAudit as jest.Mock).mockResolvedValue(undefined)
})

describe("GET /api/planning", () => {
  it("no consulta la configuración si el usuario no está autorizado", async () => {
    const { from } = mockClient()
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      error: "Forbidden",
    })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it("autoriza y devuelve una configuración válida", async () => {
    mockClient()
    const response = await GET()

    expect(response.status).toBe(200)
    expect((await response.json()).config).toEqual(DEFAULT_PLANNING_CONFIG)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
    })
  })

  it("falla cerrado ante datos ausentes o inválidos", async () => {
    for (const options of [{ readError: new Error("db") }, { config: { version: 99 } }]) {
      mockClient(options)
      const response = await GET()
      expect(response.status).toBe(503)
    }
  })
})

describe("PUT /api/planning", () => {
  it("no audita ni escribe si falta autorización con MFA", async () => {
    const { from, upsert } = mockClient()
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "mfa_required",
      error: "MFA required",
    })

    const response = await PUT(new Request("http://localhost/api/planning", {
      method: "PUT",
      body: JSON.stringify(DEFAULT_PLANNING_CONFIG),
    }))

    expect(response.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
    expect(recordSecurityAudit).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("exige MFA, audita y guarda configuración validada", async () => {
    const { upsert } = mockClient()
    const response = await PUT(new Request("http://localhost/api/planning", {
      method: "PUT",
      body: JSON.stringify(DEFAULT_PLANNING_CONFIG),
    }))

    expect(response.status).toBe(200)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "config_update",
      metadata: { config_key: "practice_planning" },
    }))
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: "default",
      config: DEFAULT_PLANNING_CONFIG,
      updated_by: user.id,
    }), { onConflict: "id" })
  })

  it("rechaza superposiciones antes de auditar o escribir", async () => {
    const { upsert } = mockClient()
    const invalid = {
      ...DEFAULT_PLANNING_CONFIG,
      intervals: [
        ...DEFAULT_PLANNING_CONFIG.intervals,
        { day: "tuesday", start: "13:15", end: "14:00", activity: "CONSULTORIO SMG" },
      ],
    }
    const response = await PUT(new Request("http://localhost/api/planning", {
      method: "PUT",
      body: JSON.stringify(invalid),
    }))

    expect(response.status).toBe(400)
    expect(recordSecurityAudit).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it("no escribe si la auditoría falla", async () => {
    const { upsert } = mockClient()
    ;(recordSecurityAudit as jest.Mock).mockRejectedValue(new Error("audit"))
    const response = await PUT(new Request("http://localhost/api/planning", {
      method: "PUT",
      body: JSON.stringify(DEFAULT_PLANNING_CONFIG),
    }))

    expect(response.status).toBe(503)
    expect(upsert).not.toHaveBeenCalled()
  })
})
