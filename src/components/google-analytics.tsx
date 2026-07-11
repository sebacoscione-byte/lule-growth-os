import Script from "next/script"
import { cookies } from "next/headers"
import { ANALYTICS_CONSENT_COOKIE } from "@/lib/analytics-consent"

/**
 * Solo en las páginas públicas (landing principal + landings SEO), no en el CRM interno detrás de
 * login. Cae en silencio si no está configurado, mismo patrón que las reseñas de Google Places
 * (ver CLAUDE.md) — no bloquea nada mientras no se cree la cuenta de GA4.
 *
 * DATA-03: además, no se inyecta nada hasta que el visitante haya dado consentimiento explícito
 * (`AnalyticsConsentBanner`) — default conservador (opt-in) mientras no haya una decisión de
 * asesoría legal confirmando que no hace falta pedirlo para esta audiencia.
 */
export async function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  if (!measurementId) return null

  const cookieStore = await cookies()
  if (cookieStore.get(ANALYTICS_CONSENT_COOKIE)?.value !== "granted") return null

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  )
}
