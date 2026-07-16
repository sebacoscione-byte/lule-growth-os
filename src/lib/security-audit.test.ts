jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import { hashAuditResourceId, isSafeAuditMetadata, recordSecurityAudit } from "@/lib/security-audit"

beforeEach(() => jest.clearAllMocks())

describe("security audit", () => {
  it("persiste solo el hash del recurso y metadata administrativa", async () => {
    const insert = jest.fn().mockResolvedValue({ error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => ({ insert })) })

    await recordSecurityAudit({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      actorRole: "owner",
      action: "lead_export",
      resourceType: "lead",
      resourceId: "lead-secreto",
      metadata: { row_count: 2, format: "csv" },
    })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      resource_ref: hashAuditResourceId("lead-secreto"),
      metadata: { row_count: 2, format: "csv" },
    }))
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain("lead-secreto")
  })

  it("rechaza claves de metadata que podrían contener PII o texto libre", async () => {
    expect(isSafeAuditMetadata({ row_count: 1 })).toBe(true)
    expect(isSafeAuditMetadata({ patient_message: "hola" })).toBe(false)
    await expect(recordSecurityAudit({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      actorRole: "owner",
      action: "manual_message_send",
      resourceType: "lead",
      metadata: { content: "dato sensible" },
    })).rejects.toThrow("unsafe_audit_metadata")
    expect(getServiceDb).not.toHaveBeenCalled()
  })

  it("no propaga el error crudo de la base", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: { message: "internal details" } }) })),
    })
    await expect(recordSecurityAudit({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      actorRole: "owner",
      action: "config_update",
      resourceType: "configuration",
    })).rejects.toThrow("security_audit_unavailable")
  })
})
