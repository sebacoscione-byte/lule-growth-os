// Cookie de asignacion del test A/B del hero — misma constante usada por middleware.ts (donde se
// asigna) y por landings/[slug]/page.tsx (donde se lee) para evitar un typo silencioso entre los dos.
export const HERO_VARIANT_COOKIE = "lule_hero_variant"
const LANDING_SESSION_STORAGE_KEY = "lule_landing_session_id"

export type LandingEventType =
  | "cta_cimel" | "cta_swiss" | "cta_britanico"
  | "instructions_viewed" | "form_started" | "form_submitted"
  | "page_view"
  | "click_booking" | "click_call" | "click_whatsapp" | "click_maps"
  | "click_hero_primary" | "click_hero_secondary"

function getLandingSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined

  try {
    const existing = window.sessionStorage.getItem(LANDING_SESSION_STORAGE_KEY)
    if (existing) return existing

    const sessionId = window.crypto.randomUUID()
    window.sessionStorage.setItem(LANDING_SESSION_STORAGE_KEY, sessionId)
    return sessionId
  } catch {
    // Navegadores con storage bloqueado siguen registrando eventos, solo sin deduplicacion.
    return undefined
  }
}

export function trackLandingEvent(
  event_type: LandingEventType,
  slug: string,
  extra?: Record<string, string>
) {
  // keepalive: los CTAs de "Llamar" navegan en la misma pestaña (tel:) y los de WhatsApp/Maps
  // pueden pausar la pestaña de origen al abrir la app nativa en mobile -- sin esto, el navegador
  // puede cancelar este fetch a mitad de camino cuando la página se descarga/pausa justo después
  // del click, subcontando clicks reales. keepalive garantiza que el request sobreviva.
  fetch("/api/public/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, slug, session_id: getLandingSessionId(), ...extra }),
    keepalive: true,
  }).catch(() => {})
}
