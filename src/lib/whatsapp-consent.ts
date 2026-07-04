import { getServiceDb } from "@/lib/supabase/service"

export const CONSENT_TEXT =
  "Para ayudarte, podemos registrar tus datos de contacto, cobertura médica y motivo de consulta. No reemplaza una consulta médica. ¿Aceptás continuar?"

export const CONSENT_VERSION = "v1"

const DECLINE_PATTERNS = ["no acepto", "no quiero", "prefiero que no", "no autorizo", "no deseo"]

/** Se llama sobre la primera respuesta del paciente al mensaje combinado (saludo + consentimiento + preguntas). */
export function interpretConsentReply(text: string): boolean {
  const lower = text.toLowerCase().trim()
  if (lower === "no") return false
  return !DECLINE_PATTERNS.some(pattern => lower.includes(pattern))
}

export async function recordConsent(params: {
  waId: string
  leadId?: string | null
  consented: boolean
  source?: string
}): Promise<void> {
  const db = getServiceDb()
  await db.from("consent_records").insert({
    wa_id: params.waId,
    lead_id: params.leadId ?? null,
    consented: params.consented,
    consent_text: CONSENT_TEXT,
    version: CONSENT_VERSION,
    source: params.source ?? "whatsapp_bot",
  })
}

export async function hasConsented(waId: string): Promise<boolean> {
  const db = getServiceDb()
  const { data } = await db
    .from("consent_records")
    .select("consented")
    .eq("wa_id", waId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.consented === true
}
