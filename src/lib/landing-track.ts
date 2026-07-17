// Cookie de asignacion del test A/B del hero — misma constante usada por middleware.ts (donde se
// asigna) y por landings/[slug]/page.tsx (donde se lee) para evitar un typo silencioso entre los dos.
export const HERO_VARIANT_COOKIE = "lule_hero_variant"
const LANDING_SESSION_STORAGE_KEY = "lule_landing_session_id"

export type LandingEventType =
  | "cta_cimel" | "cta_swiss" | "cta_britanico"
  | "instructions_viewed" | "form_started" | "form_submitted"
  | "page_view"
  | "click_booking" | "click_call" | "click_whatsapp" | "click_maps"
  | "click_hero_primary" | "click_hero_secondary" | "click_instagram"

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

// Local y producción comparten la misma base de Supabase (no hay proyecto de staging separado):
// cualquier sesión de agente, corrida de Playwright o navegación manual contra `npm run dev`
// (localhost) termina grabando "visitas" reales en landing_events. Encontrado revisando el
// dashboard el 2026-07-14: page_views con horarios y volumen inconsistentes con tráfico de
// pacientes. Cortar acá (no en el servidor) para que ningún flujo de test/QA local vuelva a
// ensuciar las métricas reales, sin tocar cómo se trackea un dominio real o un preview de Vercel.
function isTrackableHostname(): boolean {
  if (typeof window === "undefined") return false
  return window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
}

export function trackLandingEvent(
  event_type: LandingEventType,
  slug: string,
  extra?: Record<string, string>
) {
  if (!isTrackableHostname()) return

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
