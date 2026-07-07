// Cookie de asignacion del test A/B del hero — misma constante usada por middleware.ts (donde se
// asigna) y por landings/[slug]/page.tsx (donde se lee) para evitar un typo silencioso entre los dos.
export const HERO_VARIANT_COOKIE = "lule_hero_variant"

export type LandingEventType =
  | "cta_cimel" | "cta_swiss" | "cta_britanico"
  | "instructions_viewed" | "form_started" | "form_submitted"
  | "page_view"
  | "click_booking" | "click_call" | "click_whatsapp" | "click_maps"
  | "click_hero_primary" | "click_hero_secondary"

export function trackLandingEvent(
  event_type: LandingEventType,
  slug: string,
  extra?: Record<string, string>
) {
  fetch("/api/public/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, slug, ...extra }),
  }).catch(() => {})
}
