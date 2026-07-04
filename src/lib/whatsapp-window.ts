import type { WhatsAppEntryPoint, WhatsAppWindowState } from "@/types"

const CUSTOMER_SERVICE_WINDOW_HOURS = 24
const FREE_ENTRY_POINT_WINDOW_HOURS = 72

export interface WhatsAppReferral {
  source_type?: string
  source_id?: string
  source_url?: string
  ctwa_clid?: string
}

/** Meta agrega `referral` al mensaje entrante cuando el paciente llega por un anuncio Click-to-WhatsApp o un boton de Pagina. */
export function detectEntryPoint(referral: WhatsAppReferral | undefined | null): {
  entryPoint: WhatsAppEntryPoint
  ctwaClid: string | null
} {
  if (referral?.ctwa_clid || referral?.source_type === "ad") {
    return { entryPoint: "ctwa", ctwaClid: referral.ctwa_clid ?? null }
  }
  if (referral?.source_type) {
    return { entryPoint: "referral", ctwaClid: null }
  }
  return { entryPoint: "organic", ctwaClid: null }
}

/**
 * Ventana de servicio al cliente (24h desde el ultimo mensaje del paciente), o Free Entry Point
 * (72h) cuando la conversacion se origino en un anuncio Click-to-WhatsApp / CTA de Pagina.
 */
export function getWindowState(
  lastInboundAt: string | null,
  entryPoint: WhatsAppEntryPoint,
  now: Date = new Date()
): WhatsAppWindowState {
  if (!lastInboundAt) return "closed"

  const elapsedHours = (now.getTime() - new Date(lastInboundAt).getTime()) / (1000 * 60 * 60)
  const windowHours = entryPoint === "ctwa" ? FREE_ENTRY_POINT_WINDOW_HOURS : CUSTOMER_SERVICE_WINDOW_HOURS
  return elapsedHours <= windowHours ? "open" : "closed"
}
