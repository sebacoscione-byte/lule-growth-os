"use client"

import { useState, useEffect } from "react"
import {
  MapPin, Clock, ChevronDown, ChevronUp, Phone, Map, MessageCircle, CalendarCheck,
  CheckCircle2, Loader2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { buildWhatsAppUrl } from "@/lib/public-landings"

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
  color: "blue" | "teal"
  preferredLocationValue: "cimel_lanus" | "swiss_lomas" | "sin_definir"
}

function useUtmParams() {
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
  }, [])
  return utms
}

// ─── Card de sede con CTA persistente ──────────────────────────────────────────

interface CtaCardProps {
  sede: SedeAction
  expanded: boolean
  onToggle: () => void
  onEngage: () => void
}

function CtaCard({ sede, expanded, onToggle, onEngage }: CtaCardProps) {
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
  }[sede.color]

  const whatsappUrl = buildWhatsAppUrl(sede.whatsappMessage)
  const phoneHref = sede.phone ? `tel:${sede.phone.replace(/[\s-]/g, "")}` : null

  return (
    <div id={`sede-${sede.key}`} className={`scroll-mt-24 rounded-xl border-2 ${palette.border} overflow-hidden bg-white`}>
      <div className={`flex items-center gap-3 p-5 ${palette.header}`}>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${palette.icon} shrink-0`}>
          <MapPin className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-gray-900">{sede.name}</p>
          <div className="flex flex-wrap items-center gap-1 text-sm text-gray-500 mt-0.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{sede.hours || `Atención los ${sede.day}`}</span>
            {sede.address && (
              <>
                <span className="text-gray-300">·</span>
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
            onClick={onEngage}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${palette.primary}`}
          >
            <CalendarCheck className="h-4 w-4" />
            Pedir turno online
          </a>
        )}
        {phoneHref && (
          <a
            href={phoneHref}
            onClick={onEngage}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${sede.bookingUrl ? palette.secondary : palette.primary}`}
          >
            <Phone className="h-4 w-4" />
            Llamar
          </a>
        )}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onEngage}
          className="inline-flex items-center gap-2 rounded-full border border-green-300 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 transition-colors"
        >
          <MessageCircle className="h-4 w-4" />
          Consultar por WhatsApp
        </a>
        {sede.mapsUrl && (
          <a
            href={sede.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Map className="h-4 w-4" />
            Cómo llegar
          </a>
        )}
      </div>

      <button
        onClick={() => { onToggle(); onEngage() }}
        className="w-full flex items-center justify-between border-t border-gray-100 px-5 py-3 text-left text-sm text-gray-500 hover:text-gray-700"
      >
        Ver instrucciones detalladas para pedir turno
        {expanded
          ? <ChevronUp className="h-4 w-4 shrink-0" />
          : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{sede.instruction}</p>
        </div>
      )}
    </div>
  )
}

// ─── Formulario de lead ───────────────────────────────────────────────────────

interface LeadFormProps {
  slug: string
  locations: SedeAction[]
  engagedKeys: Set<string>
  utms: Record<string, string>
}

function LeadForm({ slug, locations, engagedKeys, utms }: LeadFormProps) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [service, setService] = useState("no_definido")
  const [location, setLocation] = useState<string>(
    locations.length === 1 ? locations[0].preferredLocationValue : "sin_definir"
  )
  const [insurance, setInsurance] = useState("")
  const [message, setMessage] = useState("")
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!consent || !phone.trim()) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          phone: phone.trim(),
          requested_service: service,
          preferred_location: location,
          insurance: insurance.trim() || null,
          general_reason: message.trim() || null,
          consent_to_contact: true,
          clicked_cimel_cta: engagedKeys.has("cimel"),
          clicked_swiss_cta: engagedKeys.has("swiss"),
          landing_page: slug,
          origin_url: window.location.href,
          ...utms,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setSubmitError(data.error ?? "Error al enviar. Intentá de nuevo.")
      } else {
        fireEvent("form_submitted", slug, utms)
        setSubmitted(true)
      }
    } catch {
      setSubmitError("Error de red. Intentá de nuevo.")
    }
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <p className="font-semibold text-lg text-gray-900">¡Recibimos tu mensaje!</p>
        <p className="text-sm text-gray-500 max-w-xs">
          Nos comunicamos a la brevedad para ayudarte a coordinar tu turno con la Dra. Lucía Chahin.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white rounded-xl border border-gray-200 p-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-gray-900">Nombre</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tu nombre"
            className="text-gray-900 placeholder:text-gray-400"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-gray-900">
            WhatsApp <span className="text-red-500">*</span>
          </Label>
          <Input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+54 11..."
            required
            className="text-gray-900 placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-gray-900">Servicio buscado</Label>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="text-gray-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no_definido">No lo sé todavía</SelectItem>
              <SelectItem value="consulta_cardiologia">Consulta cardiológica</SelectItem>
              <SelectItem value="ecocardiograma">Ecocardiograma</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-gray-900">Sede preferida</Label>
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger className="text-gray-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sin_definir">Sin preferencia</SelectItem>
              <SelectItem value="cimel_lanus">CIMEL Lanús — martes</SelectItem>
              <SelectItem value="swiss_lomas">Swiss Medical Lomas — viernes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-gray-900">
          Obra social / prepaga <span className="text-gray-400 font-normal">(opcional)</span>
        </Label>
        <Input
          value={insurance}
          onChange={e => setInsurance(e.target.value)}
          placeholder="OSDE, Swiss Medical, particular..."
          className="text-gray-900 placeholder:text-gray-400"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-gray-900">
          Mensaje <span className="text-gray-400 font-normal">(opcional)</span>
        </Label>
        <Textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="¿Qué pasó cuando intentaste pedir turno? ¿Hay algo en particular que necesitás saber?"
          rows={3}
          className="resize-none text-gray-900 placeholder:text-gray-400"
        />
      </div>

      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="consent"
          checked={consent}
          onChange={e => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 rounded"
          required
        />
        <label htmlFor="consent" className="text-sm text-gray-600 leading-relaxed">
          Acepto ser contactado para recibir información sobre cómo pedir turno con la Dra. Lucía Chahin.
          Mis datos no serán usados para ningún otro fin.
        </label>
      </div>

      {submitError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {submitError}
        </div>
      )}

      <Button
        type="submit"
        disabled={submitting || !consent || !phone.trim()}
        className="w-full"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Enviar
      </Button>
    </form>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

const TRACKED_KEYS = new Set(["cimel", "swiss"])

function fireEvent(
  event_type: string,
  slug: string,
  utms: Record<string, string>
) {
  fetch("/api/public/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, slug, ...utms }),
  }).catch(() => {})
}

export function LandingInteractions({ slug, locations }: { slug: string; locations: SedeAction[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [engagedKeys, setEngagedKeys] = useState<Set<string>>(new Set())
  const utms = useUtmParams()

  function engage(key: string) {
    if (engagedKeys.has(key)) return
    setEngagedKeys(prev => new Set(prev).add(key))
    if (TRACKED_KEYS.has(key)) fireEvent(`cta_${key}`, slug, utms)
  }

  return (
    <>
      <section id="pedir-turno" className="scroll-mt-20 py-12 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="mb-2 text-center text-xl font-bold text-gray-900">Pedir turno</h2>
          <p className="mb-4 text-center text-sm text-gray-500">
            Elegí la sede y reservá por el canal que prefieras. No se otorgan turnos desde esta web.
          </p>

          {locations.map(sede => (
            <CtaCard
              key={sede.key}
              sede={sede}
              expanded={expandedKey === sede.key}
              onToggle={() => setExpandedKey(prev => prev === sede.key ? null : sede.key)}
              onEngage={() => engage(sede.key)}
            />
          ))}
        </div>
      </section>

      <section className="px-4 pb-12">
        <div className="mx-auto max-w-2xl">
          <p className="mb-4 text-center text-sm text-gray-500">
            ¿No pudiste pedir turno? Dejanos tu contacto y te ayudamos.
          </p>
          <LeadForm slug={slug} locations={locations} engagedKeys={engagedKeys} utms={utms} />
        </div>
      </section>
    </>
  )
}
