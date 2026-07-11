/**
 * DATA-03: mientras no haya una decisión de asesoría legal confirmando que no hace falta,
 * Google Analytics solo se carga después de un consentimiento explícito — default conservador
 * (opt-in, no opt-out). El valor vive en esta cookie de primera parte, compartida entre el
 * banner (cliente) y el componente que decide si inyecta el script de GA4 (servidor).
 */
export const ANALYTICS_CONSENT_COOKIE = "lule_analytics_consent"
export type AnalyticsConsentValue = "granted" | "denied"
