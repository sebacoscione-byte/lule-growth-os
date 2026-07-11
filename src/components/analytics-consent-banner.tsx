"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ANALYTICS_CONSENT_COOKIE, type AnalyticsConsentValue } from "@/lib/analytics-consent"

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1]
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

/**
 * Solo se muestra si hay GA4 configurado (si no, no hay nada que pedir) y todavía no se registró
 * una decisión — DATA-03, ver src/components/google-analytics.tsx.
 */
export function AnalyticsConsentBanner() {
  const [visible, setVisible] = useState(false)

  // El valor de la cookie no existe en el servidor — recién se puede saber tras montar en el
  // cliente. Arranca oculto (coincide con el render del servidor) y se revela después del mount
  // si todavía no hay una decisión registrada.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) return
    if (readCookie(ANALYTICS_CONSENT_COOKIE)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- revelar tras el mount es la única forma de leer una cookie que no existe durante el render del servidor
    setVisible(true)
  }, [])

  if (!visible) return null

  function decide(value: AnalyticsConsentValue) {
    writeCookie(ANALYTICS_CONSENT_COOKIE, value)
    setVisible(false)
    if (value === "granted") window.location.reload()
  }

  return (
    // bottom-16 en mobile para no taparse con el CTA sticky de las landings (fixed, sm:hidden).
    <div className="fixed inset-x-0 bottom-16 z-50 border-t border-line bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] sm:bottom-0">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-xs text-ink-soft">
          Usamos Google Analytics para medir visitas de forma agregada (sin tu nombre ni
          teléfono). ¿Nos das tu consentimiento? Ver{" "}
          <Link href="/privacidad" className="underline">política de privacidad</Link>.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide("denied")}
            className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-paper-dim transition-colors"
          >
            Rechazar
          </button>
          <button
            onClick={() => decide("granted")}
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-ink/90 transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  )
}
