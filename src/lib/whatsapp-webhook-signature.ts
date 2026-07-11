import { createHmac, timingSafeEqual } from "crypto"

// Verifica que un POST al webhook de WhatsApp venga realmente de Meta (X-Hub-Signature-256,
// HMAC-SHA256 con el App Secret) y no sea un mensaje "entrante" forjado por cualquiera que
// descubra la URL del webhook.
//
// Fail-closed a propósito (WA-01, 2026-07-11): si WHATSAPP_APP_SECRET no está configurado, se
// rechaza el POST. Antes dejaba pasar sin validar ("fail-open") para no cortar el bot de un día
// para el otro, pero eso significa que cualquiera que descubra la URL del webhook puede forjar
// mensajes "entrantes" mientras la env var no esté cargada. Ver CLAUDE.md.
export function isValidWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return false
  if (!signatureHeader) return false

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex")
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(signatureHeader)
  if (expectedBuffer.length !== receivedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, receivedBuffer)
}
