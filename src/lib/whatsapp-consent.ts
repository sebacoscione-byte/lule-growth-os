import { getServiceDb } from "@/lib/supabase/service"
import { PUBLIC_SITE_ORIGIN } from "@/lib/tracked-links"

export const CONSENT_TEXT =
  `Para orientarte sobre cómo pedir turno, necesitamos registrar tu número, cobertura, sede elegida y motivo administrativo de contacto. No usamos este canal para diagnóstico ni para recibir estudios. Podés consultar la política de privacidad en ${PUBLIC_SITE_ORIGIN}/privacidad. ¿Aceptás que tratemos esos datos para responder esta consulta?`

export const CONSENT_VERSION = "v2-administrative-service"
export const CONSENT_PURPOSE = "administrative_service"
export const CONSENT_ACCEPT_BUTTON_ID = "consent_accept"
export const CONSENT_DECLINE_BUTTON_ID = "consent_decline"

export const FOLLOWUP_CONSENT_TEXT =
  "¿Querés que te escribamos una sola vez para saber si pudiste pedir el turno? Es opcional y no incluye promociones."
export const FOLLOWUP_CONSENT_VERSION = "v1-appointment-followup"
export const FOLLOWUP_CONSENT_PURPOSE = "appointment_followup"
export const FOLLOWUP_ACCEPT_BUTTON_ID = "followup_accept"
export const FOLLOWUP_DECLINE_BUTTON_ID = "followup_decline"

export const PROTOCOL_CONSENT_TEXT =
  "Confirmación para recibir información sobre un protocolo de investigación. La participación es voluntaria y esta elección no determina elegibilidad."
export const PROTOCOL_CONSENT_VERSION = "v1-research-protocol-information"
export const PROTOCOL_CONSENT_PURPOSE = "research_protocol"

export type ConsentDecision = "accepted" | "declined" | "unknown"

function normalizeConsentText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

/** Solo una aceptación o un rechazo inequívocos cambian el estado del consentimiento. */
export function interpretConsentReply(text: string, buttonId?: string): ConsentDecision {
  if (buttonId === CONSENT_ACCEPT_BUTTON_ID) return "accepted"
  if (buttonId === CONSENT_DECLINE_BUTTON_ID) return "declined"
  if (buttonId) return "unknown"

  const normalized = normalizeConsentText(text)
  if (
    normalized === "no" ||
    /\b(?:no acepto|no autorizo|no quiero continuar|no deseo continuar|prefiero (?:que )?no|rechazo)\b/.test(normalized)
  ) {
    return "declined"
  }
  if (/^(?:si|acepto|acepto y continuo|autorizo|estoy de acuerdo|de acuerdo)(?:\b|[.,!])/.test(normalized)) {
    return "accepted"
  }
  return "unknown"
}

export async function recordConsent(params: {
  waId: string
  leadId?: string | null
  consented: boolean
  source?: string
  evidenceMessageId?: string | null
}): Promise<void> {
  const db = getServiceDb()
  const row = {
    wa_id: params.waId,
    lead_id: params.leadId ?? null,
    consented: params.consented,
    consent_text: CONSENT_TEXT,
    version: CONSENT_VERSION,
    purpose: CONSENT_PURPOSE,
    evidence_message_id: params.evidenceMessageId ?? null,
    source: params.source ?? "whatsapp_bot",
  }
  const write = params.evidenceMessageId
    ? await db.from("consent_records").upsert(row, {
        onConflict: "purpose,evidence_message_id",
        ignoreDuplicates: true,
      })
    : await db.from("consent_records").insert(row)

  // Fail closed: si no queda evidencia durable, el bot no puede avanzar al intake.
  if (write.error) throw new Error("No se pudo registrar el consentimiento administrativo.")
}

export async function hasConsented(waId: string): Promise<boolean> {
  try {
    const db = getServiceDb()
    const { data, error } = await db
      .from("consent_records")
      .select("consented")
      .eq("wa_id", waId)
      .eq("purpose", CONSENT_PURPOSE)
      .eq("version", CONSENT_VERSION)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return !error && data?.consented === true
  } catch {
    return false
  }
}

export async function recordAppointmentFollowupConsent(params: {
  waId: string
  leadId: string
  consented: boolean
  evidenceMessageId?: string | null
  source?: string
}): Promise<void> {
  const db = getServiceDb()
  const row = {
    wa_id: params.waId,
    lead_id: params.leadId,
    consented: params.consented,
    consent_text: FOLLOWUP_CONSENT_TEXT,
    version: FOLLOWUP_CONSENT_VERSION,
    purpose: FOLLOWUP_CONSENT_PURPOSE,
    evidence_message_id: params.evidenceMessageId ?? null,
    source: params.source ?? "whatsapp_bot",
  }
  const write = params.evidenceMessageId
    ? await db.from("consent_records").upsert(row, {
        onConflict: "purpose,evidence_message_id",
        ignoreDuplicates: true,
      })
    : await db.from("consent_records").insert(row)
  if (write.error) throw new Error("No se pudo registrar la preferencia de seguimiento.")
}

/** Registra exclusivamente la elección del botón de invitación a protocolo. No implica elegibilidad. */
export async function recordResearchProtocolConsent(params: {
  waId: string
  leadId: string
  consented: boolean
  evidenceMessageId?: string | null
  source?: string
}): Promise<void> {
  const db = getServiceDb()
  const row = {
    wa_id: params.waId,
    lead_id: params.leadId,
    consented: params.consented,
    consent_text: PROTOCOL_CONSENT_TEXT,
    version: PROTOCOL_CONSENT_VERSION,
    purpose: PROTOCOL_CONSENT_PURPOSE,
    evidence_message_id: params.evidenceMessageId ?? null,
    source: params.source ?? "whatsapp_protocol_invitation",
  }
  const write = params.evidenceMessageId
    ? await db.from("consent_records").upsert(row, {
        onConflict: "purpose,evidence_message_id",
        ignoreDuplicates: true,
      })
    : await db.from("consent_records").insert(row)
  if (write.error) throw new Error("No se pudo registrar la preferencia sobre el protocolo.")
}
