import { createHmac, timingSafeEqual } from "crypto"

// Verifica que un POST al webhook de WhatsApp venga realmente de Meta (X-Hub-Signature-256,
// HMAC-SHA256 con el App Secret) y no sea un mensaje "entrante" forjado por cualquiera que
// descubra la URL del webhook.
//
// Si WHATSAPP_APP_SECRET todavía no está seteado, deja pasar sin validar (fail-open) para no
// cortar el bot en producción de un día para el otro — agregar esa env var en Vercel activa la
// verificación real. Ver CLAUDE.md.
export function isValidWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return true
  if (!signatureHeader) return false

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex")
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(signatureHeader)
  if (expectedBuffer.length !== receivedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}
