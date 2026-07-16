import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY } from "./medical-safety"
import { WhatsAppResponseKeySchema } from "./whatsapp-policy"
import {
  WHATSAPP_RESPONSE_CATALOG,
  getApprovedWhatsAppResponse,
  renderApprovedWhatsAppResponse,
} from "./whatsapp-response-catalog"

describe("catálogo aprobado de WhatsApp", () => {
  it("cubre todas las response_key cerradas", () => {
    expect(Object.keys(WHATSAPP_RESPONSE_CATALOG).sort()).toEqual([...WhatsAppResponseKeySchema.options].sort())
    expect(Object.isFrozen(WHATSAPP_RESPONSE_CATALOG)).toBe(true)
    expect(Object.isFrozen(WHATSAPP_RESPONSE_CATALOG.medical_boundary)).toBe(true)
    expect(Object.isFrozen(WHATSAPP_RESPONSE_CATALOG.medical_boundary.allowedVariables)).toBe(true)
  })

  it("reutiliza literalmente los dos guardrails médicos existentes", () => {
    expect(getApprovedWhatsAppResponse("possible_emergency").body).toBe(EMERGENCY_REPLY)
    expect(getApprovedWhatsAppResponse("medical_boundary").body).toBe(MEDICAL_BOUNDARY_REPLY)
  })

  it("renderiza solo variables declaradas", () => {
    expect(renderApprovedWhatsAppResponse("show_booking_instructions", {
      location_name: "CIMEL Lanús",
      booking_channel: "el canal institucional",
    })).toContain("CIMEL Lanús")

    expect(() => renderApprovedWhatsAppResponse("thanks_close", {
      location_name: "dato extra",
    })).toThrow("Unexpected variable")
  })

  it("rechaza variables faltantes y marcadores inyectados", () => {
    expect(() => renderApprovedWhatsAppResponse("coverage_not_verified")).toThrow("Missing variable")
    expect(() => renderApprovedWhatsAppResponse("coverage_not_verified", {
      coverage_name: "{{otro_marcador}}",
    })).toThrow("Invalid variable")
  })
})
