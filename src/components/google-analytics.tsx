import Script from "next/script"

/**
 * Solo en las páginas públicas (landing principal + landings SEO), no en el CRM interno detrás de
 * login. Cae en silencio si no está configurado, mismo patrón que las reseñas de Google Places
 * (ver CLAUDE.md) — no bloquea nada mientras no se cree la cuenta de GA4.
 */
export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  if (!measurementId) return null

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
