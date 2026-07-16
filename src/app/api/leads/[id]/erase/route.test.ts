jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))
jest.mock("@/lib/data-erasure", () => ({
  eraseLead: jest.fn(),
  DataErasureDispatchInFlightError: class DataErasureDispatchInFlightError extends Error {},
}))

import { POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { recordSecurityAudit } from "@/lib/security-audit"
import { DataErasureDispatchInFlightError, eraseLead } from "@/lib/data-erasure"

const user = { id: "00000000-0000-4000-8000-000000000001" }

beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({ auth: { getUser: jest.fn() } })
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true, user, role: "doctor", legacyCompatibility: false, assuranceLevel: "aal2",
  })
  ;(recordSecurityAudit as jest.Mock).mockResolvedValue(undefined)
  ;(eraseLead as jest.Mock).mockResolvedValue(undefined)
})

describe("POST /api/leads/[id]/erase", () => {
  it("requiere owner/doctor y AAL2, audita sin email y luego borra", async () => {
    const response = await POST(new Request("http://localhost/api/leads/lead-1/erase", { method: "POST" }), {
      params: Promise.resolve({ id: "lead-1" }),
    })
    expect(response.status).toBe(200)
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"], sensitive: true,
    })
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "lead_erasure_request", actorUserId: user.id, resourceId: "lead-1",
    }))
    expect(eraseLead).toHaveBeenCalledWith("lead-1", user.id)
  })

  it("no borra si el gate rechaza el rol", async () => {
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false, status: 403, code: "forbidden", error: "No tenés permisos para esta acción",
    })
    const response = await POST(new Request("http://localhost/api/leads/lead-1/erase", { method: "POST" }), {
      params: Promise.resolve({ id: "lead-1" }),
    })
    expect(response.status).toBe(403)
    expect(eraseLead).not.toHaveBeenCalled()
  })

  it("no expone el error crudo de borrado", async () => {
    ;(eraseLead as jest.Mock).mockRejectedValue(new Error("phone=54911 secret"))
    const response = await POST(new Request("http://localhost/api/leads/lead-1/erase", { method: "POST" }), {
      params: Promise.resolve({ id: "lead-1" }),
    })
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain("54911")
  })

  it("devuelve un conflicto reintentable si un envío a Meta sigue en vuelo", async () => {
    ;(eraseLead as jest.Mock).mockRejectedValue(new DataErasureDispatchInFlightError())
    const response = await POST(new Request("http://localhost/api/leads/lead-1/erase", { method: "POST" }), {
      params: Promise.resolve({ id: "lead-1" }),
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "dispatch_in_flight",
    }))
  })
})
