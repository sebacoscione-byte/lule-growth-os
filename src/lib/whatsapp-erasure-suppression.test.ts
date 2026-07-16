jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import {
  assertWhatsAppErasureNotSuppressed,
  WhatsAppErasureSuppressedError,
} from "./whatsapp-erasure-suppression"

describe("assertWhatsAppErasureNotSuppressed", () => {
  it("permite continuar sólo ante una respuesta booleana negativa", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await expect(assertWhatsAppErasureNotSuppressed("5491100000000", "wamid.new"))
      .resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith("is_whatsapp_erasure_suppressed", {
      p_phone: "5491100000000",
      p_source_key: "wamid.new",
    })
  })

  it("convierte un tombstone durable en una supresión intencional", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    })
    await expect(assertWhatsAppErasureNotSuppressed("5491100000000", "wamid.erased"))
      .rejects.toBeInstanceOf(WhatsAppErasureSuppressedError)
  })

  it("usa el timestamp para suprimir una entrega de Meta anterior al borrado", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null })
    ;(getServiceDb as jest.Mock).mockReturnValue({ rpc })
    await expect(assertWhatsAppErasureNotSuppressed(
      "5491100000000",
      "wamid.delayed",
      "2026-07-16T10:00:00.000Z"
    )).rejects.toBeInstanceOf(WhatsAppErasureSuppressedError)
    expect(rpc).toHaveBeenCalledWith("is_whatsapp_erasure_event_suppressed", {
      p_phone: "5491100000000",
      p_source_key: "wamid.delayed",
      p_occurred_at: "2026-07-16T10:00:00.000Z",
    })
  })

  it("falla cerrado si no puede comprobar el estado de borrado", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue({
      rpc: jest.fn().mockResolvedValue({ data: null, error: { code: "db_down" } }),
    })
    await expect(assertWhatsAppErasureNotSuppressed("5491100000000", "wamid.unknown"))
      .rejects.toThrow("whatsapp_erasure_check_failed")
  })
})
