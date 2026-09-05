jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/instagram-inbox", () => ({
  backfillInstagramInbox: jest.fn(),
  subscribeInstagramAccount: jest.fn(),
}))
jest.mock("@/lib/security-audit", () => ({ recordSecurityAudit: jest.fn() }))

import { GET, POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { backfillInstagramInbox, subscribeInstagramAccount } from "@/lib/instagram-inbox"
import { recordSecurityAudit } from "@/lib/security-audit"

beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({ auth: {} })
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true,
    user: { id: "staff-1" },
    role: "owner",
    assuranceLevel: "aal2",
  })
  ;(recordSecurityAudit as jest.Mock).mockResolvedValue(undefined)
})

describe("Instagram inbox API", () => {
  it("exige un rol asistencial y MFA para leer", async () => {
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false, status: 403, code: "mfa_required", error: "MFA requerido",
    })
    const response = await GET(new Request("http://localhost/api/instagram-business/inbox"))
    expect(response.status).toBe(403)
    expect(getServiceDb).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor", "reception"],
      sensitive: true,
    })
  })

  it("devuelve sólo campos mínimos y vigentes", async () => {
    const limit = jest.fn().mockResolvedValue({
      data: [{ id: "1", item_type: "message", content: "Hola" }], error: null,
    })
    const order = jest.fn(() => ({ limit }))
    const gt = jest.fn(() => ({ order }))
    const select = jest.fn(() => ({ gt }))
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => ({ select })) })
    const response = await GET(new Request("http://localhost/api/instagram-business/inbox"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [{ id: "1", item_type: "message", content: "Hola" }] })
    expect(select).toHaveBeenCalledWith("id,item_type,direction,participant_username,content,attachment_type,occurred_at,source")
  })

  it("audita antes de suscribir y sincronizar", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({ db: true })
    ;(subscribeInstagramAccount as jest.Mock).mockResolvedValue(undefined)
    ;(backfillInstagramInbox as jest.Mock).mockResolvedValue({
      mediaScanned: 23, commentsFound: 2, conversationsFound: 1, messagesFound: 3, stored: 5,
    })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(recordSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "config_update",
      metadata: { config_key: "instagram_inbox" },
    }))
    expect((recordSecurityAudit as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((subscribeInstagramAccount as jest.Mock).mock.invocationCallOrder[0])
    expect(await response.json()).toEqual(expect.objectContaining({ stored: 5, subscribed: true }))
  })

  it("no ejecuta acciones si no puede registrar la auditoría", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({ db: true })
    ;(recordSecurityAudit as jest.Mock).mockRejectedValue(new Error("db"))
    const response = await POST()
    expect(response.status).toBe(503)
    expect(subscribeInstagramAccount).not.toHaveBeenCalled()
    expect(backfillInstagramInbox).not.toHaveBeenCalled()
  })
})
