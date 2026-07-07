"use client"

import { useState, useEffect } from "react"
import { MapPin, Clock, ChevronDown, ChevronUp, Phone, Map, MessageCircle, CalendarCheck } from "lucide-react"
import { buildWhatsAppUrl } from "@/lib/public-landings"
import { trackLandingEvent } from "@/lib/landing-track"

export interface SedeAction {
  key: string
  name: string
  day: string
  hours?: string
  address?: string
  phone?: string
  mapsUrl?: string
  bookingUrl?: string
  instruction: string
  whatsappMessage: string
  whatsapp?: string
  color: "blue" | "teal" | "britanico"
  preferredLocationValue: "cimel_lanus" | "swiss_lomas" | "hospital_britanico" | "sin_definir"
}

function useUtmParams(onReady?: (utms: Record<string, string>) => void) {
  const [utms, setUtms] = useState<Record<string, string>>({})
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const result: Record<string, string> = {}
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const val = sp.get(key)
      if (val) result[key] = val
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUtms(result)
    onReady?.(result)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return utms
}

// ─── Card de sede con CTA persistente ──────────────────────────────────────────

type CtaClickAction = "booking" | "call" | "whatsapp" | "maps"

interface CtaCardProps {
  sede: SedeAction
  expanded: boolean
  onToggle: () => void
  onEngage: () => void
  onClickAction: (action: CtaClickAction) => void
}

function CtaCard({ sede, expanded, onToggle, onEngage, onClickAction }: CtaCardProps) {
  const palette = {
    blue: {
      border: "border-blue-200",
      header: "bg-blue-50",
      icon: "bg-blue-600",
      primary: "bg-blue-600 hover:bg-blue-700 text-white",
      secondary: "border border-blue-300 text-blue-700 hover:bg-blue-50",
    },
    teal: {
      border: "border-teal-200",
      header: "bg-teal-50",
      icon: "bg-teal-600",
      primary: "bg-teal-600 hover:bg-teal-700 text-white",
      secondary: "border border-teal-300 text-teal-700 hover:bg-teal-50",
    },
    britanico: {
      border: "border-britanico-soft",
      header: "bg-britanico-soft",
      icon: "bg-britanico",
      primary: "bg-britanico hover:opacity-90 text-white",
      secondary: "border border-britanico-soft text-britanico hover:bg-britanico-soft",
    },
  }[sede.color]

  const whatsappUrl = buildWhatsAppUrl(sede.whatsappMessage, sede.whatsapp)
  const phoneHref = sede.phone ? `tel:${sede.phone.replace(/[\s-]/g, "")}` : null

  return (
    <div id={`sede-${sede.key}`} className={`scroll-mt-24 rounded-xl border-2 ${palette.border} overflow-hidden bg-white`}>
      <div className={`flex items-center gap-3 p-5 ${palette.header}`}>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${palette.icon} shrink-0`}>
          <MapPin className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-ink">{sede.name}</p>
          <div className="flex flex-wrap items-center gap-1 text-sm text-ink-soft mt-0.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{sede.hours || `Atención los ${sede.day}`}</span>
            {sede.address && (
              <>
                <span className="text-line">·</span>
                <span>{sede.address}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 p-5">
        {sede.bookingUrl && (
          <a
            href={sede.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { onEngage(); onClickAction("booking") }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${palette.primary}`}
          >
            <CalendarCheck className="h-4 w-4" />
            Pedir turno online
          </a>
        )}
        {phoneHref && (
          <a
            href={phoneHref}
            onClick={() => { onEngage(); onClickAction("call") }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${sede.bookingUrl ? palette.secondary : palette.primary}`}
          >
            <Phone className="h-4 w-4" />
            Llamar
          </a>
        )}
        {sede.whatsapp && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { onEngage(); onClickAction("whatsapp") }}
            className="inline-flex items-center gap-2 rounded-full border border-green-300 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            Consultar por WhatsApp
          </a>
        )}
        {sede.mapsUrl && (
          <a
            href={sede.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { onEngage(); onClickAction("maps") }}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-ink-soft hover:text-ink transition-colors"
          >
            <Map className="h-4 w-4" />
            Cómo llegar
          </a>
        )}
      </div>

      <button
        onClick={() => { onToggle(); onEngage() }}
        className="w-full flex items-center justify-between border-t border-line px-5 py-3 text-left text-sm text-ink-soft hover:text-ink"
      >
        Ver instrucciones detalladas para pedir turno
        {expanded
          ? <ChevronUp className="h-4 w-4 shrink-0" />
          : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-line bg-paper p-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{sede.instruction}</p>
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

type TrackedSedeKey = "cimel" | "swiss" | "britanico"
const TRACKED_KEYS = new Set<TrackedSedeKey>(["cimel", "swiss", "britanico"])
function isTrackedKey(key: string): key is TrackedSedeKey {
  return TRACKED_KEYS.has(key as TrackedSedeKey)
}

export function LandingInteractions({
  slug,
  locations,
  heroVariant,
}: {
  slug: string
  locations: SedeAction[]
  heroVariant?: "a" | "b"
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [engagedKeys, setEngagedKeys] = useState<Set<string>>(new Set())
  const variantExtra = heroVariant ? { variant: heroVariant } : undefined
  const utms = useUtmParams(freshUtms =>
    trackLandingEvent("page_view", slug, { ...variantExtra, ...freshUtms })
  )

  function engage(key: string) {
    if (engagedKeys.has(key)) return
    setEngagedKeys(prev => new Set(prev).add(key))
    if (isTrackedKey(key)) trackLandingEvent(`cta_${key}`, slug, { ...utms, ...variantExtra })
  }

  function trackClick(key: string, action: CtaClickAction) {
    if (isTrackedKey(key)) {
      trackLandingEvent(`click_${action}`, slug, { ...utms, ...variantExtra, location_key: key })
    }
  }

  return (
    <section id="pedir-turno" className="scroll-mt-20 py-12 px-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <h2 className="font-display mb-2 text-center text-2xl font-semibold text-ink">Pedir turno</h2>
        <p className="mb-4 text-center text-sm text-ink-soft">
          Elegí la sede y reservá por el canal que prefieras. No se otorgan turnos desde esta web.
        </p>

        {locations.map(sede => (
          <CtaCard
            key={sede.key}
            sede={sede}
            expanded={expandedKey === sede.key}
            onToggle={() => setExpandedKey(prev => prev === sede.key ? null : sede.key)}
            onEngage={() => engage(sede.key)}
            onClickAction={action => trackClick(sede.key, action)}
          />
        ))}
      </div>
    </section>
  )
}
