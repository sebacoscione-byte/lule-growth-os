import { createHmac } from "crypto"
import { isValidWhatsAppSignature } from "./whatsapp-webhook-signature"

const SECRET = "test-app-secret"

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
}

describe("isValidWhatsAppSignature", () => {
  it("acepta una firma válida calculada con el mismo secreto", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] })
    const signature = sign(body, SECRET)
    expect(isValidWhatsAppSignature(body, signature, SECRET)).toBe(true)
  })

  it("rechaza una firma calculada con un secreto distinto", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] })
    const signature = sign(body, "otro-secreto")
    expect(isValidWhatsAppSignature(body, signature, SECRET)).toBe(false)
  })

  it("rechaza si el body fue alterado después de firmarlo", () => {
    const original = JSON.stringify({ object: "whatsapp_business_account", entry: [1] })
    const signature = sign(original, SECRET)
    const tampered = JSON.stringify({ object: "whatsapp_business_account", entry: [1, 2] })
    expect(isValidWhatsAppSignature(tampered, signature, SECRET)).toBe(false)
  })

  it("rechaza si no viene header de firma", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] })
    expect(isValidWhatsAppSignature(body, null, SECRET)).toBe(false)
  })

  it("deja pasar (fail-open) si todavía no hay WHATSAPP_APP_SECRET configurado", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] })
    expect(isValidWhatsAppSignature(body, null, undefined)).toBe(true)
    expect(isValidWhatsAppSignature(body, "sha256=cualquier-cosa", undefined)).toBe(true)
  })
})
