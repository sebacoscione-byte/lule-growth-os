"use client"

import type { ReactNode } from "react"
import { trackLandingEvent } from "@/lib/landing-track"

export function HeroCtaLink({
  href,
  slug,
  variant,
  position,
  className,
  children,
}: {
  href: string
  slug: string
  variant: "a" | "b"
  position: "primary" | "secondary"
  className: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => trackLandingEvent(
        position === "primary" ? "click_hero_primary" : "click_hero_secondary",
        slug,
        { variant }
      )}
    >
      {children}
    </a>
  )
}
