import { interpretConsentReply } from "@/lib/whatsapp-consent"

describe("interpretConsentReply", () => {
  it("una respuesta con los datos pedidos cuenta como consentimiento aceptado", () => {
    expect(interpretConsentReply("Turno cardiologico, tengo OSDE, tengo 45 años, zona Lanus")).toBe(true)
  })

  it("un 'no' seco se interpreta como rechazo", () => {
    expect(interpretConsentReply("no")).toBe(false)
  })

  it("'no acepto' se interpreta como rechazo", () => {
    expect(interpretConsentReply("No acepto, gracias")).toBe(false)
  })

  it("'no autorizo' se interpreta como rechazo", () => {
    expect(interpretConsentReply("No autorizo el uso de mis datos")).toBe(false)
  })
})
