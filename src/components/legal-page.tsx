import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import { AnalyticsConsentBanner } from "@/components/analytics-consent-banner"
import { EcgDivider } from "@/components/ecg-divider"
import { GoogleAnalytics } from "@/components/google-analytics"

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="font-display mb-3 text-xl font-semibold text-ink">{title}</h2>
        <div className="space-y-3 text-sm leading-6 text-ink-soft">{children}</div>
      </div>
    </section>
  )
}

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen bg-white">
      <GoogleAnalytics />
      <AnalyticsConsentBanner />

      <section className="bg-paper px-4 pb-6 pt-14">
        <div className="mx-auto max-w-2xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-soft/70">
            <Link href="/dra-lucia-chahin" className="hover:underline">
              ← Volver al sitio
            </Link>
          </p>
          <h1 className="font-display text-3xl font-semibold text-ink">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-ink-soft">{description}</p>
          <p className="mt-2 text-xs text-ink-soft/70">Última actualización: 5 de septiembre de 2026.</p>
        </div>
      </section>

      <EcgDivider />
      {children}

      <footer className="border-t border-line px-4 py-10 text-center text-xs text-ink-soft/70">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <p>Dra. Lucía Chahin — Médica Cardióloga y Ecocardiografista</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <Link href="/dra-lucia-chahin" className="hover:underline">Sitio principal</Link>
          <Link href="/privacidad" className="hover:underline">Política de privacidad</Link>
          <Link href="/terminos" className="hover:underline">Términos de uso</Link>
          <Link href="/eliminar-datos" className="hover:underline">Eliminar mis datos</Link>
        </div>
      </footer>
    </main>
  )
}
