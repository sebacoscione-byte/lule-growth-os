jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import { DataErasureDispatchInFlightError, eraseLead } from "./data-erasure"

describe("eraseLead", () => {
  beforeEach(() => jest.clearAllMocks())

  it("distingue un dispatch en vuelo sin exponer el error de Postgres", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "whatsapp_erasure_dispatch_in_flight", details: null, hint: null },
      }),
    })

    await expect(eraseLead("lead-1", "staff-1"))
      .rejects.toBeInstanceOf(DataErasureDispatchInFlightError)
  })

  it("sanitiza cualquier otro fallo de base", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "phone=54911 secret", details: null, hint: null },
      }),
    })

    await expect(eraseLead("lead-1", "staff-1"))
      .rejects.toThrow("data_erasure_failed")
  })
})
