import { createHmac } from "node:crypto"
import { isValidInstagramSignature } from "./instagram-webhook-signature"

describe("isValidInstagramSignature", () => {
  it("acepta solamente la firma HMAC-SHA256 correcta", () => {
    const body = JSON.stringify({ object: "instagram" })
    const secret = "test-secret"
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
    expect(isValidInstagramSignature(body, signature, secret)).toBe(true)
    expect(isValidInstagramSignature(`${body}x`, signature, secret)).toBe(false)
  })

  it("falla cerrado sin secreto, firma o con longitud inválida", () => {
    expect(isValidInstagramSignature("{}", null, "secret")).toBe(false)
    expect(isValidInstagramSignature("{}", "sha256=abc", undefined)).toBe(false)
    expect(isValidInstagramSignature("{}", "sha256=abc", "secret")).toBe(false)
  })
})
