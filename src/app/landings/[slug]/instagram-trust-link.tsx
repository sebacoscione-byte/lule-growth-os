"use client"

import { trackLandingEvent } from "@/lib/landing-track"

// Glyph clásico de Instagram (trazo, no relleno) para que combine con el resto de los íconos
// de lucide-react usados en esta página -- lucide ya no incluye íconos de marcas.
function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

export function InstagramTrustLink({
  slug,
  username,
  className,
}: {
  slug: string
  username: string
  className?: string
}) {
  return (
    <a
      href={`https://www.instagram.com/${username}/`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackLandingEvent("click_instagram", slug)}
      aria-label={`Instagram de la Dra. Lucía Chahin, @${username} (se abre en una pestaña nueva)`}
      className={
        className ??
        "inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm transition-colors hover:border-cardiac/50 hover:text-cardiac sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
      }
    >
      <InstagramGlyph className="h-3.5 w-3.5 shrink-0 text-cardiac sm:h-4 sm:w-4" />
      Conocé su trabajo en Instagram
      <span className="text-ink-soft/60">@{username}</span>
    </a>
  )
}
