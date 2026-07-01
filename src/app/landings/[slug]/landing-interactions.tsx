"use client"

import { useState, useEffect } from "react"
import {
  MapPin, Clock, ChevronDown, ChevronUp,
  CheckCircle2, Loader2, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

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

// ─── CTA expandible ───────────────────────────────────────────────────────────

interface CtaCardProps {
  color: "blue" | "teal"
  title: string
  subtitle: string
  address?: string
  steps: string[]
  note: string
  expanded: boolean
  onToggle: () => void
}

function CtaCard({ color, title, subtitle, address, steps, note, expanded, onToggle }: CtaCardProps) {
  const palette = {
    blue: {
      border: "border-blue-200",
      header: "bg-blue-50 hover:bg-blue-100",
      icon: "bg-blue-600",
      chevron: "text-blue-600",
      step: "bg-blue-100 text-blue-700",
      noteText: "text-blue-700",
    },
    teal: {
      border: "border-teal-200",
      header: "bg-teal-50 hover:bg-teal-100",
      icon: "bg-teal-600",
      chevron: "text-teal-600",
      step: "bg-teal-100 text-teal-700",
      noteText: "text-teal-700",
    },
  }[color]

  return (
    <div className={`rounded-xl border-2 ${palette.border} overflow-hidden`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between p-5 ${palette.header} transition-colors text-left`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${palette.icon}`}>
            <MapPin className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">{title}</p>
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
              <Clock className="h-3.5 w-3.5" />
              <span>{subtitle}</span>
              {address && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>{address}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {expanded
          ? <ChevronUp className={`h-5 w-5 ${palette.chevron} shrink-0`} />
          : <ChevronDown className="h-5 w-5 text-gray-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="bg-white p-6 border-t border-gray-100">
          <p className="font-medium text-gray-900 mb-4">Pasos para pedir turno:</p>
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full ${palette.step} text-sm font-bold shrink-0`}>
                  {i + 1}
                </span>
                <span className="text-gray-700 text-sm pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className={`mt-4 text-sm font-medium ${palette.noteText}`}>{note}</p>
        </div>
      )}
    </div>
  )
}

// ─── Formulario de lead ───────────────────────────────────────────────────────

interface LeadFormProps {
  slug: string
  clickedCimel: boolean
  clickedSwiss: boolean
  utms: Record<string, string>
}

function LeadForm({ slug, clickedCimel, clickedSwiss, utms }: LeadFormProps) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [service, setService] = useState("no_definido")
  const [location, setLocation] = useState("sin_definir")
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
          general_reason: message.trim() || null,
          consent_to_contact: true,
          clicked_cimel_cta: clickedCimel,
          clicked_swiss_cta: clickedSwiss,
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

export function LandingInteractions({ slug }: { slug: string }) {
  const [expandedCta, setExpandedCta] = useState<"cimel" | "swiss" | null>(null)
  const [clickedCimel, setClickedCimel] = useState(false)
  const [clickedSwiss, setClickedSwiss] = useState(false)
  const utms = useUtmParams()

  function toggleCimel() {
    const willExpand = expandedCta !== "cimel"
    setExpandedCta(prev => prev === "cimel" ? null : "cimel")
    if (willExpand && !clickedCimel) {
      setClickedCimel(true)
      fireEvent("cta_cimel", slug, utms)
    }
  }
  function toggleSwiss() {
    const willExpand = expandedCta !== "swiss"
    setExpandedCta(prev => prev === "swiss" ? null : "swiss")
    if (willExpand && !clickedSwiss) {
      setClickedSwiss(true)
      fireEvent("cta_swiss", slug, utms)
    }
  }

  return (
    <>
      {/* CTAs expandibles */}
      <section className="py-12 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">Cómo pedir turno</h2>

          <CtaCard
            color="blue"
            title="Pedir turno en CIMEL Lanús"
            subtitle="Martes"
            address="Tucumán 1314, Lanús"
            steps={[
              "Comunicate con CIMEL Lanús.",
              "Pedí turno con la Dra. Lucía Chahin.",
              "Indicá si buscás consulta cardiológica o ecocardiograma.",
            ]}
            note="Ella atiende los martes en CIMEL Lanús."
            expanded={expandedCta === "cimel"}
            onToggle={toggleCimel}
          />

          <CtaCard
            color="teal"
            title="Pedir turno en Swiss Medical Lomas"
            subtitle="Viernes"
            steps={[
              "Llamá al 0810-333-8876 o usá la app de Swiss Medical.",
              "Buscá o solicitá a la Dra. Lucía Chahin.",
              "Indicá si buscás consulta cardiológica o ecocardiograma.",
            ]}
            note="Ella atiende los viernes en Swiss Medical Lomas de Zamora."
            expanded={expandedCta === "swiss"}
            onToggle={toggleSwiss}
          />
        </div>
      </section>

    </>
  )
}
