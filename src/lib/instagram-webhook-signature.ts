import { createHmac, timingSafeEqual } from "node:crypto"

/** Verifica X-Hub-Signature-256 con el secreto de la app de Instagram. Falla cerrado. */
export function isValidInstagramSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret || !signatureHeader) return false

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(signatureHeader)
  if (expectedBuffer.length !== receivedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}
