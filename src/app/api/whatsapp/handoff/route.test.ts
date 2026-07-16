jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/whatsapp-handoff", () => ({
  takeHandoffForLead: jest.fn(),
  resolveHandoffForLead: jest.fn(),
  closeHandoffForLead: jest.fn(),
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
import { closeHandoffForLead, resolveHandoffForLead, takeHandoffForLead } from "@/lib/whatsapp-handoff"
import { recordSecurityAudit } from "@/lib/security-audit"

function auth(user: { id: string; email?: string } | null) {
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  })
}

beforeEach(() => jest.clearAllMocks())

describe("POST /api/whatsapp/handoff", () => {
  it("requiere autenticación", async () => {
    auth(null)
    const response = await POST(new Request("http://localhost/api/whatsapp/handoff", {
      method: "POST", body: JSON.stringify({ lead_id: "lead-1", action: "take" }),
    }))
    expect(response.status).toBe(401)
  })

  it.each([
    ["take", takeHandoffForLead],
    ["reactivate", resolveHandoffForLead],
    ["close", closeHandoffForLead],
  ] as const)("ejecuta la acción explícita %s", async (action, operation) => {
    auth({ id: "staff-1", email: "staff@example.com" })
    const response = await POST(new Request("http://localhost/api/whatsapp/handoff", {
      method: "POST", body: JSON.stringify({ lead_id: "lead-1", action }),
    }))
    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledWith("lead-1", "staff-1")
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: `handoff_${action}`,
      actorUserId: "staff-1",
      resourceId: "lead-1",
    }))
  })

  it("rechaza acciones desconocidas", async () => {
    auth({ id: "staff-1", email: "staff@example.com" })
    const response = await POST(new Request("http://localhost/api/whatsapp/handoff", {
      method: "POST", body: JSON.stringify({ lead_id: "lead-1", action: "delete" }),
    }))
    expect(response.status).toBe(400)
  })
})
