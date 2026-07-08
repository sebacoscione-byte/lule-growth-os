"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Archive, ArchiveRestore, BookOpen, Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, Link2, Loader2,
  ImageIcon, Plus, Save, Search, Send, ShieldCheck, Sparkles, Pin, Undo2, Unlink, WandSparkles, X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { parseAiJson } from "@/lib/parse-ai-json"
import { DEFAULT_AUTO_PUBLISH_SETTINGS } from "@/lib/content-pipeline"
import type { AutoPublishSettings, AutoPublishTrackSettings, ContentChannel, ContentItem, ContentSlide, ContentSource, ContentStatus } from "@/types"

const IS_MANUAL_MODE = process.env.NEXT_PUBLIC_AI_MODE !== "gemini_api"

const CATEGORIES = [
  "Consulta cardiologica", "Ecocardiograma", "Presion arterial", "Colesterol",
  "Palpitaciones", "Chequeo cardiovascular", "Factores de riesgo",
  "Atencion en Lanus", "Atencion en Lomas", "Atencion en Hospital Britanico", "Como pedir turno",
]

const CTA_OPTIONS = [
  "",
  "Link en la bio para pedir turno",
  "Link en la bio → turnos en CIMEL Lanús (martes)",
  "Link en la bio → turnos en Hospital Británico (miércoles)",
  "Link en la bio → turnos en Swiss Medical Lomas (viernes)",
  "Link en la bio para consulta o ecocardiograma",
]

const FORMATS = [
  { value: "reel", label: "Reel / portada" },
  { value: "historia", label: "Historia" },
  { value: "carrusel", label: "Carrusel" },
  { value: "post", label: "Post estatico" },
]

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "Borrador",
  approved: "Aprobado",
  published: "Publicado",
  archived: "Archivado",
}

const STYLE_CLASSES = {
  rose: "from-rose-600 to-pink-800",
  blue: "from-blue-600 to-slate-900",
  teal: "from-teal-600 to-cyan-900",
}

const EDITABLE_FIELDS: Array<keyof ContentItem> = [
  "hook", "caption", "google_text", "hashtags", "visual_headline",
  "visual_subtitle", "visual_style", "image_prompt", "image_alt_text", "slides",
]

function editableContent(item: ContentItem) {
  return Object.fromEntries(EDITABLE_FIELDS.map(field => [field, item[field]])) as Partial<ContentItem>
}

function capHashtags(raw: string, max = 5): string {
  const tags = raw.match(/#[\p{L}0-9_]+/gu) ?? []
  return tags.slice(0, max).join(" ")
}

function CharacterCount({ value, limit }: { value: string; limit?: number }) {
  const overLimit = limit !== undefined && value.length > limit
  return (
    <span className={`text-xs ${overLimit ? "font-medium text-red-600" : "text-gray-400"}`}>
      {value.length}{limit ? ` / ${limit}` : ""} caracteres
    </span>
  )
}

function fallbackImagePrompt(item: ContentItem) {
  const ratio = item.format === "historia" ? "9:16 vertical Instagram Story" : "4:5 vertical Instagram feed"
  return `Create a scroll-stopping premium editorial plate for a cardiology social media post about "${item.topic}". ${ratio}. Use one instantly understandable focal point and a relatable everyday moment that makes a potential patient feel recognized or motivated to take a preventive step. Create gentle visual tension between postponing care and choosing to take care of oneself, without fear, pain or urgency. Sophisticated deep blue, burgundy and warm neutral palette, natural cinematic lighting, realistic texture and depth. Reserve a clean, high-contrast area for the exact requested Spanish headline and subtitle. Avoid cold hospital imagery, generic medical stock photography, recognizable real physicians and advertising clichés. No extra text, no logos, no watermark.`
}

function VisualCard({ item, compact = false }: { item: ContentItem; compact?: boolean }) {
  if (item.visual_url) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
        <Image
          src={item.visual_url}
          alt={item.image_alt_text || `Placa visual sobre ${item.topic}`}
          fill
          unoptimized
          className="object-cover"
        />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/90">
          Placa generada
        </span>
      </div>
    )
  }
  return (
    <div className={`aspect-square rounded-2xl bg-gradient-to-br ${STYLE_CLASSES[item.visual_style]} p-6 text-white flex flex-col justify-between shadow-sm`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/75">
        <span>Concepto generado por IA</span>
        <ImageIcon className="h-4 w-4" />
      </div>
      <div>
        <p className={`${compact ? "text-xl" : "text-3xl"} font-bold leading-tight`}>{item.visual_headline}</p>
        <p className="mt-3 text-sm text-white/80">{item.visual_subtitle}</p>
      </div>
      <p className="text-xs text-white/70">Martes en Lanus · Miércoles en Británico · Viernes en Lomas</p>
    </div>
  )
}

function SlideCard({ slide, index, style, compact = false }: { slide: ContentSlide; index: number; style: ContentItem["visual_style"]; compact?: boolean }) {
  return (
    <div className={`${compact ? "w-28 flex-shrink-0" : "w-full"} aspect-square rounded-xl bg-gradient-to-br ${STYLE_CLASSES[style]} p-3 text-white flex flex-col justify-between shadow-sm`}>
      <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">{index + 1}</span>
      <div>
        <p className={`${compact ? "text-xs" : "text-base"} font-bold leading-tight`}>{slide.headline}</p>
        <p className={`${compact ? "text-[10px]" : "text-sm"} text-white/80 mt-1 line-clamp-3`}>{slide.text}</p>
      </div>
    </div>
  )
}

function CarouselPreview({ item, compact = false }: { item: ContentItem; compact?: boolean }) {
  const slides = item.slides
  if (!slides || slides.length === 0) return <VisualCard item={item} compact={compact} />
  if (compact) {
    return (
      <div className="space-y-2">
        <VisualCard item={item} compact />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {slides.map((slide, i) => (
            <SlideCard key={i} slide={slide} index={i} style={item.visual_style} compact />
          ))}
        </div>
        <p className="text-xs text-gray-400 text-center">{slides.length + 1} slides · Portada + {slides.length} contenido</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Portada</p>
        <VisualCard item={item} />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Slides de contenido ({slides.length})</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {slides.map((slide, i) => (
            <SlideCard key={i} slide={slide} index={i} style={item.visual_style} />
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center">Total: {slides.length + 1} slides. Usá estos contenidos en Canva o Instagram para armar las placas.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manual prompt panel
// ---------------------------------------------------------------------------

function ManualPanel({
  prompt,
  onProcess,
  onDismiss,
}: {
  prompt: string
  onProcess: (response: string) => Promise<void>
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState("")
  const [processing, setProcessing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  async function handleProcess() {
    setParseError(null)
    setProcessing(true)
    try {
      await onProcess(pasted)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Error al procesar la respuesta")
    }
    setProcessing(false)
  }

  function copyPrompt() {
    navigator.clipboard.writeText(prompt).catch(() => {
      const el = document.createElement("textarea")
      el.value = prompt
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            Prompt listo — copialo y pegalo en la IA
          </CardTitle>
          <button onClick={onDismiss} className="text-xs text-gray-500 hover:text-gray-900">✕ cerrar</button>
        </div>
        <p className="text-xs text-gray-600">
          Modo manual activo. Usá tu cuenta de ChatGPT, Gemini o Claude gratis.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Prompt text */}
        <Textarea
          rows={11}
          value={prompt}
          readOnly
          className="font-mono text-xs bg-white text-gray-900 border-gray-300 resize-none"
        />

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={copyPrompt} className="gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado!" : "Copiar prompt"}
          </Button>
          <Button variant="outline" onClick={() => window.open("https://chatgpt.com/", "_blank")} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Abrir ChatGPT
          </Button>
          <Button variant="outline" onClick={() => window.open("https://gemini.google.com/", "_blank")} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Abrir Gemini
          </Button>
          <Button variant="outline" onClick={() => window.open("https://claude.ai/", "_blank")} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Abrir Claude
          </Button>
        </div>

        {/* Instructions */}
        <ol className="text-xs text-gray-700 space-y-1 list-decimal list-inside bg-blue-50 rounded-lg p-3">
          <li>Copiá el prompt de arriba</li>
          <li>Abrí ChatGPT, Gemini o Claude con tu cuenta</li>
          <li>Pegá el prompt y envialo</li>
          <li>Copiá la respuesta completa (el JSON)</li>
          <li>Pegala abajo y hacé clic en <strong>Procesar</strong></li>
        </ol>

        {/* Paste area */}
        <div className="border-t pt-4 space-y-2">
          <Label className="text-gray-900">Pegá la respuesta de la IA acá</Label>
          <Textarea
            rows={8}
            placeholder='Pegá aquí la respuesta completa. Ejemplo: { "hook": "...", "caption": "...", ... }'
            value={pasted}
            onChange={e => { setPasted(e.target.value); setParseError(null) }}
            className="text-gray-900 placeholder:text-gray-400"
          />
          {parseError && (
            <p className="text-xs text-red-600 bg-red-50 rounded p-2">{parseError}</p>
          )}
          <Button
            onClick={handleProcess}
            disabled={!pasted.trim() || processing}
            className="w-full gap-2"
          >
            {processing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Sparkles className="h-4 w-4" />}
            Procesar y guardar como borrador
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Bio y Fijados panel
// ---------------------------------------------------------------------------

interface CopyBlockProps {
  title: string
  subtitle?: string
  content: string
  charLimit?: number
}

function CopyBlock({ title, subtitle, content, charLimit }: CopyBlockProps) {
  const [copied, setCopied] = useState(false)

  function doCopy() {
    navigator.clipboard.writeText(content).catch(() => {
      const el = document.createElement("textarea")
      el.value = content
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-gray-900">{title}</CardTitle>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            {charLimit !== undefined && <CharacterCount value={content} limit={charLimit} />}
          </div>
          <Button variant="outline" size="sm" onClick={doCopy} className="gap-1.5 shrink-0">
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 rounded-lg p-4 border border-gray-200">
          {content}
        </pre>
      </CardContent>
    </Card>
  )
}

// Nombre va en el campo "Nombre" del perfil (no en la bio); sedes abreviadas para entrar en el límite de 150 caracteres de Instagram con 3 sedes.
const BIO_TEMPLATE = `🫀 Médica Cardióloga
📍 CIMEL (mar) · Británico (mié) · Swiss (vie)
Ecocardiografía y salud cardiovascular
👇 Más info y contacto`

const POST_FIJADO_1 = `📌 Cómo pedir turno con la Dra. Lucía Chahin

La Dra. Lucía Chahin atiende:

📍 CIMEL Lanús — martes
📍 Hospital Británico — miércoles
📍 Swiss Medical Lomas — viernes

Realiza:
• Consultas de cardiología
• Ecocardiogramas

Para pedir turno, comunicate con la institución correspondiente y solicitá atención con la Dra. Lucía Chahin.

Para solicitar turno con la Dra. Lucía Chahin, ingresá al link de la bio y elegí la sede donde querés atenderte.`

const POST_FIJADO_2 = `❤️ Consulta cardiológica y ecocardiograma

La Dra. Lucía Chahin atiende consultas cardiológicas y realiza ecocardiogramas.

Podés solicitar turno en:
• CIMEL Lanús
• Hospital Británico
• Swiss Medical Lomas

En el link de la bio te explicamos cómo pedirlo.`

const POST_FIJADO_3 = `📍 Dónde atiende la Dra. Lucía Chahin

Martes: CIMEL Lanús, Tucumán 1314, Lanús
Miércoles: Hospital Británico, Perdriel 74, CABA
Viernes: Swiss Medical Lomas

Para pedir turno, ingresá al link de la bio y elegí la sede que prefieras.`

const DESTACADAS_TEMPLATE = `Historias destacadas sugeridas:

1. 📅 Turnos
   → Cómo pedir turno paso a paso:
   1. Elegí sede (CIMEL, Hospital Británico o Swiss Medical)
   2. Comunicate con la institución
   3. Pedí turno con la Dra. Lucía Chahin
   4. Indicá si buscás consulta cardiológica o ecocardiograma

2. 🏥 CIMEL
   → Información sobre CIMEL Lanús
   → Dirección y cómo llegar
   → Días de atención (martes)

3. 🏥 Hospital Británico
   → Información sobre el Hospital Británico
   → Dirección y cómo llegar
   → Días de atención (miércoles)

4. 🏥 Swiss
   → Información sobre Swiss Medical Lomas
   → Días de atención (viernes)

5. ❤️ Ecocardiograma
   → Qué es un ecocardiograma
   → Cómo solicitar turno
   → En qué sedes se realiza

6. 🩺 Cardiología
   → Qué es una consulta cardiológica
   → Cuándo consultar
   → Cómo pedir turno

7. ❓ FAQ
   → Preguntas frecuentes
   → ¿Cómo pedir turno? ¿Dónde atiende? ¿Qué días?`

const CTAS_TEMPLATE = `CTAs correctos para posts y stories:

✅ USAR:
• "Para solicitar turno con la Dra. Lucía Chahin, ingresá al link de la bio y elegí la sede donde querés atenderte."
• "¿Buscás consulta cardiológica o ecocardiograma? En el link de la bio te explicamos cómo pedir turno."
• "La Dra. Lucía Chahin atiende los martes en CIMEL Lanús, los miércoles en el Hospital Británico y los viernes en Swiss Medical Lomas."
• "En el link de la bio te explicamos cómo pedir turno."
• "Escribí CARDIO y te pasamos cómo solicitar turno."
• "Escribí ECO si necesitás información sobre ecocardiograma."

❌ NO USAR:
• "Sacá turno ya"
• "Últimos lugares"
• "No te dejes estar"
• "Si tenés palpitaciones vení"
• "Tu dolor de pecho puede ser grave"`

function BioYFijadosTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <Pin className="h-4 w-4 text-amber-600 shrink-0" />
        <span>Copiá cada bloque y pegalo directamente en Instagram. Estos textos están ajustados a los guardrails médicos.</span>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Bio de Instagram</h3>
        <CopyBlock
          title="Bio sugerida"
          subtitle="Pegala en Editar perfil → Biografía (reemplazá todo el texto actual)"
          content={BIO_TEMPLATE}
          charLimit={150}
        />
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Publicaciones fijadas (3)</h3>
        <p className="text-sm text-gray-500 mb-3">
          Fijá estos 3 posts al principio del perfil. Aparecen antes del feed y son lo primero que ve alguien que llega al perfil.
        </p>
        <div className="space-y-4">
          <CopyBlock
            title="Post fijado 1 — Cómo pedir turno"
            subtitle="El más importante. Explica el proceso completo."
            content={POST_FIJADO_1}
          />
          <CopyBlock
            title="Post fijado 2 — Servicios"
            subtitle="Qué hace la Dra. Lucía Chahin."
            content={POST_FIJADO_2}
          />
          <CopyBlock
            title="Post fijado 3 — Dónde atiende"
            subtitle="Sedes y días."
            content={POST_FIJADO_3}
          />
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Historias destacadas</h3>
        <CopyBlock
          title="Estructura de destacadas sugerida"
          subtitle="Crear 6 carpetas de destacadas con estos temas."
          content={DESTACADAS_TEMPLATE}
        />
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">CTAs correctos</h3>
        <CopyBlock
          title="Llamados a la acción — qué usar y qué evitar"
          subtitle="Para posts, reels, stories y carruseles."
          content={CTAS_TEMPLATE}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Publicacion automatica: tarjeta por cronograma (posts / historias)
// ---------------------------------------------------------------------------

function isFutureStart(track: AutoPublishTrackSettings): boolean {
  return Boolean(track.starts_at) && new Date(track.starts_at as string).getTime() > Date.now()
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}

function describeAutoPublishQueue(kind: "post" | "historia", count: number, timesPerWeek: number): string {
  const label = kind === "post"
    ? `${count} post${count === 1 ? "" : "s"} aprobado${count === 1 ? "" : "s"} en cola`
    : `${count} historia${count === 1 ? "" : "s"} aprobada${count === 1 ? "" : "s"} en cola`
  if (count === 0) return `${label}.`
  const days = Math.ceil(count * (7 / timesPerWeek))
  const article = kind === "post" ? "el último saldría" : "la última saldría"
  return `${label} — a este ritmo, ${article} en unos ${days} días.`
}

function describeLastAutoPublishRun(track: AutoPublishTrackSettings): string | null {
  if (!track.last_run_at) return null
  const when = new Date(track.last_run_at).toLocaleString("es-AR")
  const reasonMap: Record<string, string> = {
    skipped_disabled: "estaba apagada",
    skipped_scheduled: "todavía no llegó la fecha de inicio programada",
    skipped_interval: "todavía no correspondía según la frecuencia configurada",
    skipped_no_item: "no había ninguna pieza aprobada lista para publicar",
    skipped_race: "el contenido elegido cambió de estado justo antes de publicar (probablemente se publicó manualmente)",
    quota_exceeded: "se alcanzó el límite diario de generación con IA, se reintenta al otro día",
    published: "se publicó correctamente",
    partial: "se publicó parcialmente (revisá el detalle en la pieza correspondiente)",
  }
  const result = track.last_run_result ?? ""
  const readable = reasonMap[result] ?? (result.startsWith("error") ? `hubo un error (${result.replace(/^error:\s*/, "")})` : result)
  return `Último intento: ${when} — ${readable}`
}

function AutoPublishTrackCard({
  title, track, queueText, saving, onToggleEnabled, onChangeTimesPerWeek, onChangeStartsAt,
}: {
  title: string
  track: AutoPublishTrackSettings
  queueText: string
  saving: boolean
  onToggleEnabled: () => void
  onChangeTimesPerWeek: (value: number) => void
  onChangeStartsAt: (iso: string | null) => void
}) {
  const scheduled = isFutureStart(track)
  const lastRun = describeLastAutoPublishRun(track)
  return (
    <div className="rounded-lg border border-gray-100 p-3 space-y-2">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={track.enabled ? "default" : "outline"}
          size="sm"
          disabled={saving}
          onClick={onToggleEnabled}
        >
          {track.enabled ? "Activada" : "Desactivada"}
        </Button>
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <Input
            type="number"
            min={1}
            max={7}
            value={track.times_per_week}
            onChange={e => onChangeTimesPerWeek(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 text-gray-900"
          />
          <span>veces por semana</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="text-gray-500 shrink-0">Empezar:</span>
        <Button
          variant={!track.starts_at ? "default" : "outline"}
          size="sm"
          disabled={saving}
          onClick={() => onChangeStartsAt(null)}
        >
          Ahora
        </Button>
        <Input
          type="datetime-local"
          value={track.starts_at ? toLocalInputValue(track.starts_at) : ""}
          onChange={e => onChangeStartsAt(e.target.value ? fromLocalInputValue(e.target.value) : null)}
          className="w-56 text-gray-900"
        />
      </div>
      <p className="text-xs text-gray-500">{queueText}</p>
      {scheduled && (
        <p className="text-xs font-medium text-blue-700">
          Programado para arrancar el {new Date(track.starts_at as string).toLocaleString("es-AR")} — hasta esa fecha no publica nada, aunque esté activada.
        </p>
      )}
      {lastRun && <p className="text-xs text-gray-500">{lastRun}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ContentStudioPage() {
  const [category, setCategory] = useState("")
  const [categorySuggestionsOpen, setCategorySuggestionsOpen] = useState(false)
  const [topic, setTopic] = useState("")
  const [briefErrors, setBriefErrors] = useState<{ category?: string; topic?: string }>({})
  const [format, setFormat] = useState<ContentItem["format"]>("post")
  const [cta, setCta] = useState("none")
  const [appointmentLink, setAppointmentLink] = useState("")
  const [sources, setSources] = useState<ContentSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ContentSource | null>(null)
  const [items, setItems] = useState<ContentItem[]>([])
  const [active, setActive] = useState<ContentItem | null>(null)
  const [loadingItems, setLoadingItems] = useState(true)
  const [researching, setResearching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState("crear")
  const [manualPrompt, setManualPrompt] = useState<string | null>(null)
  const [showDirectEntry, setShowDirectEntry] = useState(false)
  const [directPaste, setDirectPaste] = useState("")
  const [directSaving, setDirectSaving] = useState(false)
  const [creatingBlank, setCreatingBlank] = useState(false)
  const [directError, setDirectError] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState("")
  const [libraryStatus, setLibraryStatus] = useState<ContentStatus | "active">("active")
  const [libraryFormat, setLibraryFormat] = useState<ContentItem["format"] | "all">("all")
  const [igConnected, setIgConnected] = useState(false)
  const [igUsername, setIgUsername] = useState<string | null>(null)
  const [igLoading, setIgLoading] = useState(true)
  const [generatedVisual, setGeneratedVisual] = useState<{ itemId: string; url: string } | null>(null)
  const [autoPublishSettings, setAutoPublishSettings] = useState<AutoPublishSettings>(DEFAULT_AUTO_PUBLISH_SETTINGS)
  const [savedAutoPublishSettings, setSavedAutoPublishSettings] = useState<AutoPublishSettings>(DEFAULT_AUTO_PUBLISH_SETTINGS)
  const [savingAutoPublish, setSavingAutoPublish] = useState(false)
  const [autoPublishSaved, setAutoPublishSaved] = useState(false)
  const [autoPublishError, setAutoPublishError] = useState<string | null>(null)

  const lastGenRef = useRef(0)

  const loadIgStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/instagram-business/status")
      const data = await response.json()
      setIgConnected(Boolean(data.connected))
      setIgUsername(data.username ?? null)
    } catch {
      setIgConnected(false)
    }
    setIgLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIgStatus()
    const params = new URLSearchParams(window.location.search)
    if (params.has("ig_connected")) {
      window.history.replaceState({}, "", window.location.pathname)
    } else if (params.has("ig_error")) {
      setError("No se pudo conectar Instagram. Volvé a intentar conectar la cuenta.")
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [loadIgStatus])

  async function disconnectInstagram() {
    await fetch("/api/instagram-business/disconnect", { method: "POST" })
    setIgConnected(false)
    setIgUsername(null)
  }

  const loadItems = useCallback(async () => {
    try {
      const response = await fetch("/api/content/items")
      const data = await response.json()
      if (data.error) setError(data.error)
      else setItems(data.items ?? [])
    } catch {
      setError("No se pudo cargar el contenido. Recargá la página.")
    }
    setLoadingItems(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems()
  }, [loadItems])

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then(data => {
        const stored = data.auto_publish_settings
        if (stored?.post && stored?.historia) {
          const loaded = {
            channels: stored.channels ?? DEFAULT_AUTO_PUBLISH_SETTINGS.channels,
            post: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.post, ...stored.post },
            historia: { ...DEFAULT_AUTO_PUBLISH_SETTINGS.historia, ...stored.historia },
          }
          setAutoPublishSettings(loaded)
          setSavedAutoPublishSettings(loaded)
        }
      })
      .catch(() => {})
  }, [])

  const autoPublishDirty = useMemo(
    () => JSON.stringify(autoPublishSettings) !== JSON.stringify(savedAutoPublishSettings),
    [autoPublishSettings, savedAutoPublishSettings]
  )

  function updateAutoPublishSettings(updated: AutoPublishSettings) {
    setAutoPublishSettings(updated)
    setAutoPublishError(null)
    setAutoPublishSaved(false)
  }

  function updateTrackSettings(track: "post" | "historia", patch: Partial<AutoPublishTrackSettings>) {
    updateAutoPublishSettings({ ...autoPublishSettings, [track]: { ...autoPublishSettings[track], ...patch } })
  }

  async function persistAutoPublishSettings() {
    setSavingAutoPublish(true)
    setAutoPublishError(null)
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "auto_publish_settings", value: autoPublishSettings }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setSavedAutoPublishSettings(autoPublishSettings)
      setAutoPublishSaved(true)
      setTimeout(() => setAutoPublishSaved(false), 2500)
    } catch {
      setAutoPublishError("No se pudo guardar. Probá de nuevo.")
    } finally {
      setSavingAutoPublish(false)
    }
  }

  const counts = useMemo(() => ({
    draft: items.filter(item => item.status === "draft").length,
    approved: items.filter(item => item.status === "approved").length,
    approvedPost: items.filter(item => item.status === "approved" && item.format === "post").length,
    approvedHistoria: items.filter(item => item.status === "approved" && item.format === "historia").length,
  }), [items])

  const filteredItems = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("es")
    return items.filter(item => {
      const matchesStatus = libraryStatus === "active"
        ? item.status !== "archived"
        : item.status === libraryStatus
      const matchesFormat = libraryFormat === "all" || item.format === libraryFormat
      const matchesQuery = !query || [item.topic, item.category, item.hook]
        .some(value => value.toLocaleLowerCase("es").includes(query))
      return matchesStatus && matchesFormat && matchesQuery
    })
  }, [items, libraryFormat, libraryQuery, libraryStatus])

  const filteredCategories = useMemo(() => {
    const query = category.trim().toLocaleLowerCase("es")
    return query
      ? CATEGORIES.filter(value => value.toLocaleLowerCase("es").includes(query))
      : CATEGORIES
  }, [category])

  const savedActive = active ? items.find(item => item.id === active.id) : null
  const hasUnsavedChanges = Boolean(
    active && savedActive && JSON.stringify(editableContent(active)) !== JSON.stringify(editableContent(savedActive))
  )

  function startNewPiece() {
    if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Querés descartarlos y crear una pieza nueva?")) return
    setActive(null)
    setManualPrompt(null)
    setError(null)
    setBriefErrors({})
    setCategory("")
    setCategorySuggestionsOpen(false)
    setTopic("")
    setSources([])
    setSelectedSource(null)
    setTab("crear")
  }

  async function research() {
    setResearching(true)
    setError(null)
    setSelectedSource(null)
    try {
      const response = await fetch(`/api/content/sources?topic=${encodeURIComponent(topic || category)}`)
      const data = await response.json()
      if (!response.ok || data.error) return setError(data.error ?? "No se pudieron buscar fuentes")
      setSources(data.sources ?? [])
      setSelectedSource(data.sources?.[0] ?? null)
    } catch {
      setError("No se pudieron buscar fuentes. Revisá tu conexión e intentá nuevamente.")
    } finally {
      setResearching(false)
    }
  }

  async function generate() {
    const nextBriefErrors = {
      ...(!category.trim() ? { category: "Elegí o escribí una categoría." } : {}),
    }
    if (Object.keys(nextBriefErrors).length > 0) {
      setBriefErrors(nextBriefErrors)
      return
    }
    // Debounce: ignore if clicked within 2s of previous attempt
    const now = Date.now()
    if (now - lastGenRef.current < 2000) return
    lastGenRef.current = now

    setGenerating(true)
    setError(null)
    setBriefErrors({})
    setManualPrompt(null)

    let response: Response
    let generated: Record<string, unknown> & { error?: string; prompt?: string; mode?: string }
    try {
      response = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "content_plan",
          topic: topic.trim(),
          category: category.trim(),
          content_type: format,
          cta: cta === "none" ? "" : cta,
          appointment_link: appointmentLink.trim() || null,
          source: selectedSource,
        }),
      })
      generated = await response.json()
    } catch {
      setGenerating(false)
      setError("No se pudo conectar con el generador. Revisá tu conexión e intentá nuevamente.")
      return
    }
    setGenerating(false)

    // Rate limit fallback: show manual panel with the prompt
    if (response.status === 429 && generated.prompt) {
      setError(generated.error ?? "El proveedor de IA alcanzó su límite. Podés continuar en modo manual.")
      setManualPrompt(generated.prompt)
      return
    }

    if (!response.ok || generated.error) {
      return setError(generated.error ?? "No se pudo generar el contenido")
    }

    // Manual mode: show prompt panel
    if (generated.mode === "manual" && generated.prompt) {
      setManualPrompt(generated.prompt)
      return
    }

    // API mode: create content item directly
    try {
      await saveGeneratedItem(generated)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Se generó el contenido pero no se pudo guardar.")
    }
  }

  async function saveGeneratedItem(generated: Record<string, unknown>) {
    const now = new Date().toISOString()
    const generatedText = (field: string) => typeof generated[field] === "string"
      ? (generated[field] as string).trim()
      : ""
    const inferredTopic =
      topic.trim() ||
      generatedText("topic") ||
      generatedText("visual_headline") ||
      generatedText("hook") ||
      category.trim() ||
      "Contenido generado"
    const inferredCategory =
      category.trim() ||
      generatedText("category") ||
      "Contenido generado"
    const rawSlides = generated.slides
    const slides = Array.isArray(rawSlides)
      ? (rawSlides as Array<Record<string, unknown>>)
          .filter(s => typeof s.headline === "string" && typeof s.text === "string")
          .map(s => ({ headline: (s.headline as string).slice(0, 60), text: (s.text as string).slice(0, 300) }))
      : undefined

    const item: ContentItem = {
      id: crypto.randomUUID(),
      topic: inferredTopic.slice(0, 200),
      category: inferredCategory.slice(0, 160),
      format,
      goal: "Captar consultas y explicar como pedir turno",
      status: "draft",
      channels: ["instagram"],
      source: selectedSource,
      created_at: now,
      updated_at: now,
      approved_at: null,
      hook: generated.hook as string,
      caption: generated.caption as string,
      google_text: (generated.google_text as string).slice(0, 1500),
      hashtags: capHashtags(generated.hashtags as string),
      visual_headline: (generated.visual_headline as string).slice(0, 90),
      visual_subtitle: (generated.visual_subtitle as string).slice(0, 90),
      visual_style: (["rose", "blue", "teal"].includes(generated.visual_style as string)
        ? generated.visual_style
        : "blue") as "rose" | "blue" | "teal",
      image_prompt: (generated.image_prompt as string | undefined)?.slice(0, 2400),
      image_alt_text: (generated.image_alt_text as string | undefined)?.slice(0, 180),
      slides: slides && slides.length > 0 ? slides : undefined,
    }

    const saved = await fetch("/api/content/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
    if (!saved.ok) {
      const data = await saved.json().catch(() => null) as { error?: string } | null
      throw new Error(data?.error || "Se generó el contenido pero no se pudo guardar.")
    }
    setItems(previous => [item, ...previous])
    setActive(item)
    setManualPrompt(null)
  }

  async function createBlankItem() {
    setDirectError(null)
    setCreatingBlank(true)
    const now = new Date().toISOString()
    const item: ContentItem = {
      id: crypto.randomUUID(),
      topic: topic.trim() || category.trim() || "Contenido manual",
      category: category.trim() || "Contenido manual",
      format,
      goal: "Captar consultas y explicar como pedir turno",
      status: "draft",
      channels: ["instagram"],
      source: null,
      created_at: now,
      updated_at: now,
      approved_at: null,
      hook: "",
      caption: "",
      google_text: "",
      hashtags: "",
      visual_headline: "",
      visual_subtitle: "",
      visual_style: "blue",
    }
    try {
      const saved = await fetch("/api/content/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      })
      if (!saved.ok) {
        const data = await saved.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || "No se pudo crear la pieza en blanco.")
      }
      setItems(previous => [item, ...previous])
      setActive(item)
      setManualPrompt(null)
      setShowDirectEntry(false)
    } catch (e) {
      setDirectError(e instanceof Error ? e.message : "No se pudo crear la pieza en blanco.")
    } finally {
      setCreatingBlank(false)
    }
  }

  async function saveDirect() {
    if (!directPaste.trim()) return
    setDirectSaving(true)
    setDirectError(null)
    try {
      await processManualResponse(directPaste)
      setDirectPaste("")
      setShowDirectEntry(false)
    } catch (e) {
      setDirectError(e instanceof Error ? e.message : "Error al procesar la respuesta")
    }
    setDirectSaving(false)
  }

  async function processManualResponse(pasted: string) {
    let parsed: Record<string, unknown>
    try {
      parsed = parseAiJson<Record<string, unknown>>(pasted)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "No se pudo procesar la respuesta de la IA.")
    }

    const required = ["hook", "caption", "google_text", "hashtags", "visual_headline", "visual_subtitle", "image_prompt", "image_alt_text"]
    const missing = required.filter(k => typeof parsed[k] !== "string")
    if (missing.length > 0) {
      throw new Error(`Faltan campos en la respuesta: ${missing.join(", ")}. Pedile a la IA que devuelva el JSON completo.`)
    }

    await saveGeneratedItem(parsed)
  }

  async function updateItem(item: ContentItem, changes: Partial<ContentItem>) {
    setWorking(item.id)
    setError(null)
    try {
      const response = await fetch("/api/content/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, ...changes }),
      })
      const data = await response.json()
      if (!response.ok || data.error) return setError(data.error ?? "No se pudieron guardar los cambios")
      setItems(previous => previous.map(existing => existing.id === item.id ? data.item : existing))
      setActive(data.item)
    } catch {
      setError("No se pudieron guardar los cambios. Revisá tu conexión e intentá nuevamente.")
    } finally {
      setWorking(null)
    }
  }

  async function publishNow(item: ContentItem) {
    setWorking(item.id)
    setError(null)
    try {
      const response = await fetch("/api/content/publish-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setError(data.error ?? "No se pudo publicar la pieza")
        return
      }
      setItems(previous => previous.map(existing => existing.id === item.id ? data.item : existing))
      if (active?.id === item.id) setActive(data.item)
    } catch {
      setError("No se pudo publicar la pieza. Revisá tu conexión e intentá nuevamente.")
    } finally {
      setWorking(null)
    }
  }

  async function publishInstagram(item: ContentItem) {
    const freshVisualUrl = generatedVisual?.itemId === item.id ? generatedVisual.url : null
    if (!freshVisualUrl && !item.visual_url) {
      setError("Generá la placa final antes de publicar en Instagram.")
      return
    }
    setWorking(item.id)
    setError(null)
    try {
      const response = await fetch("/api/instagram-business/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          ...(freshVisualUrl ? { imageDataUrl: freshVisualUrl } : { imageUrl: item.visual_url }),
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
          format: item.format,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setError(data.error ?? "Instagram no permitio publicar")
        return
      }
      await updateItem(item, { status: "published" })
    } catch {
      setError("No se pudo conectar con Instagram. Revisá tu conexión e intentá nuevamente.")
    } finally {
      setWorking(null)
    }
  }

  async function copyInstagram(item: ContentItem) {
    await navigator.clipboard.writeText(`${item.hook}\n\n${item.caption}\n\n${item.hashtags}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estudio de contenido</h1>
          <p className="text-sm text-gray-500">
            {IS_MANUAL_MODE
              ? "Generá prompts listos para ChatGPT, Gemini o Claude. Sin costo."
              : "Investigá, generá, revisá y aprobá contenido para Instagram."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="outline" size="sm" onClick={startNewPiece} className="flex-1 gap-1.5 sm:flex-none">
            <Plus className="h-4 w-4" />
            Nueva pieza
          </Button>
          {IS_MANUAL_MODE && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              Modo manual
            </Badge>
          )}
          {!igLoading && (
            igConnected ? (
              <Button variant="outline" size="sm" onClick={disconnectInstagram} className="gap-1.5">
                <Unlink className="h-3.5 w-3.5" />
                {igUsername ? `@${igUsername}` : "Instagram conectado"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild className="gap-1.5">
                <Link href="/api/instagram-business/auth" prefetch={false}>
                  <Link2 className="h-3.5 w-3.5" />
                  Conectar Instagram
                </Link>
              </Button>
            )
          )}
          <Badge variant="outline">{counts.draft} borradores</Badge>
          <Badge variant="outline" className="border-green-300 text-green-700">{counts.approved} aprobados</Badge>
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar error" className="rounded p-0.5 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="crear">{IS_MANUAL_MODE ? "Preparar prompt" : "Crear con IA"}</TabsTrigger>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
          <TabsTrigger value="fijados">Bio y Fijados</TabsTrigger>
        </TabsList>

        <TabsContent value="crear" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
            {/* Left: brief form */}
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Brief editorial</CardTitle>
                  <Badge variant={category.trim() ? "success" : "warning"}>
                    {category.trim() ? "Listo para generar" : "Completá la categoría"}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-1 text-left text-[11px] sm:grid-cols-3 sm:gap-2 sm:text-center">
                  <div className="rounded-md bg-blue-50 px-2 py-1.5 font-medium text-blue-700">1. Definir brief</div>
                  <div className={`rounded-md px-2 py-1.5 font-medium ${selectedSource ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}>2. Fuente opcional</div>
                  <div className="rounded-md bg-gray-100 px-2 py-1.5 font-medium text-gray-500">3. Generar y revisar</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-gray-900">Categoria</Label>
                  <div
                    className="relative"
                    onBlur={event => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setCategorySuggestionsOpen(false)
                    }}
                  >
                    <Input
                      value={category}
                      onChange={event => {
                        setCategory(event.target.value)
                        setCategorySuggestionsOpen(true)
                        setBriefErrors(previous => ({ ...previous, category: undefined }))
                      }}
                      onFocus={() => setCategorySuggestionsOpen(true)}
                      placeholder="Elegí o escribí una categoría"
                      className="pr-10 text-gray-900 placeholder:text-gray-400"
                      aria-invalid={Boolean(briefErrors.category)}
                      aria-expanded={categorySuggestionsOpen}
                      aria-controls="category-suggestions"
                      role="combobox"
                    />
                    <button
                      type="button"
                      onClick={() => setCategorySuggestionsOpen(open => !open)}
                      aria-label={categorySuggestionsOpen ? "Cerrar categorías sugeridas" : "Ver categorías sugeridas"}
                      className="absolute right-0 top-0 flex h-9 w-10 items-center justify-center rounded-r-md text-gray-500 hover:text-gray-900"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${categorySuggestionsOpen ? "rotate-180" : ""}`} />
                    </button>
                    {categorySuggestionsOpen && (
                      <div
                        id="category-suggestions"
                        role="listbox"
                        className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white p-1 text-sm text-gray-900 shadow-lg"
                      >
                        {filteredCategories.map(value => (
                          <button
                            key={value}
                            type="button"
                            role="option"
                            aria-selected={category === value}
                            onClick={() => {
                              setCategory(value)
                              setCategorySuggestionsOpen(false)
                              setBriefErrors(previous => ({ ...previous, category: undefined }))
                            }}
                            className="w-full rounded-sm px-3 py-2.5 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                          >
                            {value}
                          </button>
                        ))}
                        {filteredCategories.length === 0 && (
                          <p className="px-3 py-2.5 text-gray-500">
                            Usar nueva categoría: <span className="font-medium text-gray-900">{category.trim()}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">Elegí una sugerencia o escribí una categoría nueva.</p>
                  {briefErrors.category && <p className="text-xs font-medium text-red-600">{briefErrors.category}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-900">Tema o enfoque <span className="font-normal text-gray-400">(opcional)</span></Label>
                  <Input
                    value={topic}
                    onChange={event => {
                      setTopic(event.target.value)
                      setBriefErrors(previous => ({ ...previous, topic: undefined }))
                    }}
                    placeholder="Ej: por qué controlar la presión aunque te sientas bien"
                    className="text-gray-900 placeholder:text-gray-400"
                    aria-invalid={Boolean(briefErrors.topic)}
                  />
                  {briefErrors.topic && <p className="text-xs font-medium text-red-600">{briefErrors.topic}</p>}
                  <p className="text-xs text-gray-500">Si lo dejás vacío, la IA elegirá el enfoque más atractivo y útil dentro de la categoría.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-gray-900">Formato</Label>
                    <Select value={format} onValueChange={value => setFormat(value as ContentItem["format"])}>
                      <SelectTrigger className="text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>{FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                    {(format === "reel" || format === "carrusel") && (
                      <p className="text-xs text-amber-700">Este formato no se puede publicar directo a Instagram desde acá (requiere video o varias imágenes). Vas a poder copiarlo para publicarlo manualmente. Elegí &ldquo;Post estático&rdquo; o &ldquo;Historia&rdquo; si querés publicar con un clic.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-900">CTA <span className="text-gray-400 font-normal">(opcional)</span></Label>
                    <Select value={cta} onValueChange={setCta}>
                      <SelectTrigger className="text-gray-900">
                        <SelectValue placeholder="Sin llamado a acción" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin llamado a acción</SelectItem>
                        {CTA_OPTIONS.filter(v => v).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-900">Link de turnos <span className="text-gray-400 font-normal">(opcional)</span></Label>
                  <Input
                    value={appointmentLink}
                    onChange={e => setAppointmentLink(e.target.value)}
                    placeholder="https://... (landing, Calendly, WhatsApp, etc.)"
                    className="text-gray-900 placeholder:text-gray-400"
                    type="url"
                  />
                  <p className="text-xs text-gray-400">Si no tenés link todavía, dejalo vacío y el prompt usará &ldquo;link en la bio&rdquo;.</p>
                </div>
                <Button variant="outline" onClick={research} disabled={researching || (!topic.trim() && !category.trim())} className="w-full gap-2">
                  {researching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar informacion reciente
                </Button>
                {!researching && sources.length === 0 && (topic.trim() || category.trim()) && (
                  <p className="text-xs text-gray-500">La fuente es opcional. Buscá evidencia reciente si el contenido menciona novedades o datos clínicos.</p>
                )}
                {sources.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Fuente para fundamentar</Label>
                      <button type="button" onClick={() => setSelectedSource(null)} className="text-xs text-gray-500 hover:text-gray-900">Usar sin fuente</button>
                    </div>
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {sources.map(source => (
                        <button type="button" key={source.url} onClick={() => setSelectedSource(source)}
                          className={`w-full rounded-lg border p-3 text-left text-xs ${selectedSource?.url === source.url ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                          <span className="font-medium text-gray-800 line-clamp-2">{source.title}</span>
                          <span className="mt-1 block text-gray-500">{source.publication} · {source.published_at}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Button onClick={generate} disabled={generating} className="w-full gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {IS_MANUAL_MODE ? "Preparar prompt para copiar" : "Generar propuesta completa"}
                </Button>
                <p className="text-xs text-gray-500">
                  {IS_MANUAL_MODE
                    ? "Se genera el prompt listo para pegar en ChatGPT, Gemini o Claude. Vos pegás la respuesta y la app la guarda."
                    : "La IA crea los textos y decide la dirección visual. Después, Gemini genera la placa final lista para descargar."}
                </p>

                {/* Direct entry */}
                <div className="border-t pt-3">
                  <button
                    type="button"
                    onClick={() => setShowDirectEntry(v => !v)}
                    className="flex items-center justify-between w-full text-sm text-gray-500 hover:text-gray-800 transition-colors"
                  >
                    <span>Ingresar contenido directamente</span>
                    {showDirectEntry ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>

                  {showDirectEntry && (
                    <div className="mt-3 space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-gray-900">Formato de la pieza en blanco</Label>
                        <Select value={format} onValueChange={value => setFormat(value as ContentItem["format"])}>
                          <SelectTrigger className="text-gray-900"><SelectValue /></SelectTrigger>
                          <SelectContent>{FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={createBlankItem}
                        disabled={creatingBlank}
                        className="w-full gap-2"
                      >
                        {creatingBlank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Crear pieza en blanco (completar todo a mano)
                      </Button>
                      <p className="text-xs text-gray-400">
                        {format === "historia"
                          ? "Se abre en el editor. En historias, Instagram no muestra caption ni hashtags: solo subí una imagen propia y aprobala, no hace falta escribir nada."
                          : "Se abre en el editor con todos los campos vacíos. Completalos, subí ahí mismo una imagen propia ya lista (sin pasar por Gemini) y aprobala cuando quieras para que entre a la cola de publicación."}
                      </p>
                      <div className="border-t pt-3 space-y-2">
                        <p className="text-xs text-gray-500">O pegá la respuesta JSON de una IA (ChatGPT, Gemini, Claude):</p>
                        <Textarea
                          rows={8}
                          value={directPaste}
                          onChange={e => { setDirectPaste(e.target.value); setDirectError(null) }}
                          placeholder={`Pegá acá la respuesta JSON completa. Debe incluir los textos, image_prompt listo para Gemini e image_alt_text.`}
                          className="font-mono text-xs text-gray-900 placeholder:text-gray-400 resize-none"
                        />
                        {directError && (
                          <p className="text-xs text-red-600 bg-red-50 rounded p-2">{directError}</p>
                        )}
                        <Button
                          onClick={saveDirect}
                          disabled={directSaving || !directPaste.trim()}
                          className="w-full gap-2"
                          variant="outline"
                        >
                          {directSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Procesar y guardar como borrador
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right: manual panel, editor, or empty state */}
            {manualPrompt ? (
              <ManualPanel
                prompt={manualPrompt}
                onProcess={processManualResponse}
                onDismiss={() => setManualPrompt(null)}
              />
            ) : active ? (
              <Editor
                item={active}
                working={working}
                copied={copied}
                hasUnsavedChanges={hasUnsavedChanges}
                igConnected={igConnected}
                generatedVisual={generatedVisual}
                onGeneratedVisual={setGeneratedVisual}
                onChange={setActive}
                onSave={changes => updateItem(active, changes)}
                onCopy={() => copyInstagram(active)}
                onPublishInstagram={() => publishInstagram(active)}
                onPublishNow={() => publishNow(active)}
              />
            ) : (
              <Card className="flex min-h-[420px] items-center justify-center">
                <CardContent className="text-center text-sm text-gray-500">
                  <Sparkles className="mx-auto mb-3 h-7 w-7 text-gray-300" />
                  {IS_MANUAL_MODE
                    ? "Completá el brief y hacé clic en \"Preparar prompt\"."
                    : "Genera una propuesta o abri un borrador de la biblioteca."}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="fijados" className="mt-4">
          <BioYFijadosTab />
        </TabsContent>

        <TabsContent value="biblioteca" className="mt-4">
          {loadingItems ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-gray-400" /> : (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-900">Publicación automática</CardTitle>
                  <p className="text-xs text-gray-500">
                    Publica en Instagram de a <strong>una pieza por vez</strong> — la aprobada más antigua primero — con un
                    cronograma propio para posts de feed y otro para historias, para que no salgan todas juntas.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button
                      size="sm"
                      onClick={persistAutoPublishSettings}
                      disabled={!autoPublishDirty || savingAutoPublish}
                    >
                      {savingAutoPublish ? "Guardando..." : "Guardar cambios"}
                    </Button>
                    {autoPublishDirty && !savingAutoPublish && (
                      <span className="text-xs font-medium text-amber-600">Cambios sin guardar</span>
                    )}
                    {autoPublishSaved && <span className="text-xs font-medium text-green-600">Guardado</span>}
                    {autoPublishError && <span className="text-xs font-medium text-red-600">{autoPublishError}</span>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AutoPublishTrackCard
                    title="Posts de feed"
                    track={autoPublishSettings.post}
                    queueText={describeAutoPublishQueue("post", counts.approvedPost, autoPublishSettings.post.times_per_week)}
                    saving={savingAutoPublish}
                    onToggleEnabled={() => updateTrackSettings("post", { enabled: !autoPublishSettings.post.enabled })}
                    onChangeTimesPerWeek={value => updateTrackSettings("post", { times_per_week: value })}
                    onChangeStartsAt={iso => updateTrackSettings("post", { starts_at: iso })}
                  />
                  <AutoPublishTrackCard
                    title="Historias"
                    track={autoPublishSettings.historia}
                    queueText={describeAutoPublishQueue("historia", counts.approvedHistoria, autoPublishSettings.historia.times_per_week)}
                    saving={savingAutoPublish}
                    onToggleEnabled={() => updateTrackSettings("historia", { enabled: !autoPublishSettings.historia.enabled })}
                    onChangeTimesPerWeek={value => updateTrackSettings("historia", { times_per_week: value })}
                    onChangeStartsAt={iso => updateTrackSettings("historia", { starts_at: iso })}
                  />
                </CardContent>
              </Card>
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 md:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    value={libraryQuery}
                    onChange={event => setLibraryQuery(event.target.value)}
                    placeholder="Buscar por tema, categoría o hook"
                    className="pl-9 text-gray-900"
                  />
                </div>
                <Select value={libraryStatus} onValueChange={value => setLibraryStatus(value as ContentStatus | "active")}>
                  <SelectTrigger className="w-full text-gray-900 md:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Piezas activas</SelectItem>
                    <SelectItem value="draft">Borradores</SelectItem>
                    <SelectItem value="approved">Aprobados</SelectItem>
                    <SelectItem value="published">Publicados</SelectItem>
                    <SelectItem value="archived">Archivados</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={libraryFormat} onValueChange={value => setLibraryFormat(value as ContentItem["format"] | "all")}>
                  <SelectTrigger className="w-full text-gray-900 md:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los formatos</SelectItem>
                    {FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {filteredItems.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-gray-500">
                    No hay piezas que coincidan con estos filtros.
                  </CardContent>
                </Card>
              ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map(item => (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <CarouselPreview item={item} compact />
                    <div className="flex items-center justify-between gap-2">
                      <div><p className="font-medium text-gray-900">{item.topic}</p><p className="text-xs text-gray-500">{item.format} · {new Date(item.created_at).toLocaleDateString("es-AR")}</p></div>
                      <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
                    </div>
                    {item.auto_publish_result && Object.values(item.auto_publish_result).includes("error") && (
                      <p className="text-xs font-medium text-red-600">
                        No se pudo publicar en {Object.entries(item.auto_publish_result).filter(([, v]) => v === "error").map(([k]) => k === "instagram" ? "Instagram" : "Google Business").join(" ni ")}. Reintentá con los botones de abajo.
                      </p>
                    )}
                    {((item.tracked_visits ?? 0) > 0 || (item.tracked_interactions ?? 0) > 0) && (
                      <p className="text-xs text-gray-500">
                        {item.tracked_visits} visitas · {item.tracked_interactions} interacciones (link de seguimiento)
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setActive(item); setManualPrompt(null); setTab("crear") }}>
                        <BookOpen className="h-4 w-4" /> Abrir
                      </Button>
                      {item.status === "approved" && (
                        <Button
                          size="sm"
                          className="flex-1 gap-1.5"
                          disabled={working === item.id}
                          onClick={() => publishNow(item)}
                          title="Publica ya mismo en los canales asignados a esta pieza, sin esperar a la publicación automática"
                        >
                          {working === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Publicar ahora
                        </Button>
                      )}
                      {item.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Volver a borrador"
                          title="Vuelve a borrador para editarla, sin riesgo de que se publique sola mientras tanto"
                          disabled={working === item.id}
                          onClick={() => updateItem(item, { status: "draft" })}
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {item.status === "published" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Deshacer publicación"
                          title="Vuelve la pieza a 'aprobada' para corregirla. OJO: no borra la publicación real en Instagram — eso se hace a mano desde la app si hizo falta."
                          disabled={working === item.id}
                          onClick={() => {
                            if (!window.confirm("Esto NO borra la publicación real en Instagram — solo devuelve esta pieza a \"aprobada\" acá en el sistema para poder corregirla y volver a publicar. Si necesitás borrar el posteo real, hacelo a mano desde la app. ¿Continuar?")) return
                            updateItem(item, { status: "approved", auto_publish_result: {} })
                          }}
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={item.status === "archived" ? "Restaurar pieza" : "Archivar pieza"}
                        onClick={() => updateItem(item, { status: item.status === "archived" ? "draft" : "archived" })}
                      >
                        {item.status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Link de seguimiento (utm_content por pieza)
// ---------------------------------------------------------------------------

function TrackedLinkField({ itemId, visits, interactions }: { itemId: string; visits: number; interactions: number }) {
  const [copied, setCopied] = useState(false)
  const trackedUrl = typeof window !== "undefined" ? `${window.location.origin}/api/content/track/${itemId}` : ""

  function copy() {
    navigator.clipboard.writeText(trackedUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-gray-900">Link de seguimiento</Label>
        {(visits > 0 || interactions > 0) && (
          <span className="text-xs text-gray-500">{visits} visitas · {interactions} interacciones</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input value={trackedUrl} readOnly className="bg-white text-xs text-gray-600" />
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Redirige a la landing pública identificando esta pieza (utm_content). Instagram no permite links
        clickeables en posts de feed — usalo en el link sticker de historias o en tu bio/Linktree.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

function Editor({
  item, working, copied, hasUnsavedChanges, igConnected, generatedVisual, onGeneratedVisual,
  onChange, onSave, onCopy, onPublishInstagram, onPublishNow,
}: {
  item: ContentItem
  working: string | null
  copied: boolean
  hasUnsavedChanges: boolean
  igConnected: boolean
  generatedVisual: { itemId: string; url: string } | null
  onGeneratedVisual: (visual: { itemId: string; url: string } | null) => void
  onChange: (item: ContentItem) => void
  onSave: (changes: Partial<ContentItem>) => void
  onCopy: () => void
  onPublishInstagram: () => void
  onPublishNow: () => void
}) {
  const busy = working === item.id
  const [visualGenerating, setVisualGenerating] = useState(false)
  const [visualError, setVisualError] = useState<string | null>(null)
  const [visualHelpUrl, setVisualHelpUrl] = useState<string | null>(null)
  const [altTextGenerating, setAltTextGenerating] = useState(false)
  const [altTextError, setAltTextError] = useState<string | null>(null)
  const [directionGenerating, setDirectionGenerating] = useState(false)
  const [directionError, setDirectionError] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)
  const [showHistoriaText, setShowHistoriaText] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagePrompt = item.image_prompt?.trim() || fallbackImagePrompt(item)
  const displayedVisualUrl = generatedVisual?.itemId === item.id ? generatedVisual.url : item.visual_url
  const isHistoria = item.format === "historia"
  const approvalReady = Boolean(
    (isHistoria || (item.hook.trim() && item.caption.trim())) &&
    (item.visual_headline.trim() || item.visual_url)
  )

  function updateSlide(index: number, changes: Partial<ContentSlide>) {
    if (!item.slides) return
    onChange({
      ...item,
      slides: item.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...changes } : slide),
    })
  }

  async function generateVisual() {
    setVisualGenerating(true)
    setVisualError(null)
    setVisualHelpUrl(null)
    try {
      const response = await fetch("/api/content/visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          category: item.category,
          topic: item.topic,
          format: item.format,
          visual_headline: item.visual_headline,
          visual_subtitle: item.visual_subtitle,
          image_prompt: imagePrompt,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setVisualError(data.error ?? "No se pudo generar la placa visual.")
        setVisualHelpUrl(typeof data.help_url === "string" ? data.help_url : null)
        return
      }
      onGeneratedVisual({ itemId: item.id, url: `data:${data.mime_type};base64,${data.image_data}` })
      if (data.visual_url) {
        onSave({ visual_url: data.visual_url })
      } else {
        setVisualError(
          `La placa se generó pero no se pudo guardar (${data.visual_persist_error ?? "error desconocido"}). ` +
          "Se va a perder si navegás a otra pestaña — descargala o publicá ahora antes de salir."
        )
      }
    } catch {
      setVisualError("No se pudo conectar con Gemini para generar la placa.")
    } finally {
      setVisualGenerating(false)
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setImageUploading(true)
    setImageUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
        reader.readAsDataURL(file)
      })
      const response = await fetch("/api/content/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, imageDataUrl: dataUrl }),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error ?? "No se pudo subir la imagen.")
      onGeneratedVisual(null)
      onSave({ visual_url: data.visual_url })
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "No se pudo subir la imagen.")
    } finally {
      setImageUploading(false)
    }
  }

  async function regenerateImageDirection() {
    setDirectionGenerating(true)
    setDirectionError(null)
    try {
      const response = await fetch("/api/content/image-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: item.category,
          topic: item.topic,
          format: item.format,
          visual_headline: item.visual_headline,
          visual_subtitle: item.visual_subtitle,
          caption: item.caption,
          previous_image_prompt: imagePrompt,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setDirectionError(data.error ?? "No se pudo regenerar la dirección visual.")
        return
      }
      onChange({ ...item, image_prompt: data.image_prompt, image_alt_text: data.image_alt_text })
    } catch {
      setDirectionError("No se pudo conectar con la IA para regenerar la dirección visual.")
    } finally {
      setDirectionGenerating(false)
    }
  }

  async function regenerateAltText() {
    if (
      item.image_alt_text?.trim() &&
      !window.confirm("Esto va a reemplazar el texto alternativo actual (describe la imagen real, no lo que hayas escrito a mano). ¿Continuar?")
    ) return
    setAltTextGenerating(true)
    setAltTextError(null)
    try {
      const response = await fetch("/api/content/alt-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: item.topic,
          visual_headline: item.visual_headline,
          visual_subtitle: item.visual_subtitle,
          image_prompt: imagePrompt,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setAltTextError(data.error ?? "No se pudo regenerar el texto alternativo.")
        return
      }
      onChange({ ...item, image_alt_text: data.image_alt_text })
    } catch {
      setAltTextError("No se pudo conectar con la IA para regenerar el texto alternativo.")
    } finally {
      setAltTextGenerating(false)
    }
  }

  function downloadGeneratedVisual() {
    if (!generatedVisual || generatedVisual.itemId !== item.id) return
    const link = document.createElement("a")
    link.href = generatedVisual.url
    link.download = `lule-${item.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`
    link.click()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Card className="border-violet-200 bg-violet-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-gray-900">
              <WandSparkles className="h-4 w-4 text-violet-600" />
              Placa final con Gemini
            </CardTitle>
            <p className="text-xs text-gray-600">
              Gemini resuelve la escena, composición, tipografía, contraste y zonas seguras según el formato.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {displayedVisualUrl ? (
              <Image
                src={displayedVisualUrl}
                alt={item.image_alt_text || `Placa visual sobre ${item.topic}`}
                width={1024}
                height={item.format === "historia" ? 1820 : 1280}
                unoptimized
                className="h-auto w-full rounded-xl border border-violet-100"
              />
            ) : (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-violet-200 bg-white p-6 text-center text-sm text-gray-500">
                La dirección visual ya está definida por la IA. Generá la placa final cuando quieras revisarla o publicarla.
              </div>
            )}
            {visualError && (
              <div className="space-y-2 rounded-md bg-red-50 p-3 text-xs text-red-700">
                <p>{visualError}</p>
                {visualHelpUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(visualHelpUrl, "_blank")}
                    className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Revisar cuota de Gemini
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-2 sm:flex">
              <Button onClick={generateVisual} disabled={visualGenerating} className="w-full flex-1 gap-2">
                {visualGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                {displayedVisualUrl ? "Regenerar placa" : "Generar placa final"}
              </Button>
              {generatedVisual?.itemId === item.id && (
                <Button variant="outline" onClick={downloadGeneratedVisual} className="w-full flex-1 gap-2">
                  <Download className="h-4 w-4" />
                  Descargar placa
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={imageUploading}
                className="w-full gap-2"
              >
                {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                Subir imagen propia (sin generar con IA)
              </Button>
              {imageUploadError && <p className="text-xs text-red-600 bg-red-50 rounded p-2">{imageUploadError}</p>}
            </div>
            <details className="rounded-lg border border-violet-100 bg-white p-3 text-xs text-gray-600" open={Boolean(directionError)}>
              <summary className="cursor-pointer font-medium text-gray-800">Ver dirección visual decidida por la IA</summary>
              <div className="mt-2 space-y-2">
                <p className="whitespace-pre-wrap">{imagePrompt}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={regenerateImageDirection}
                  disabled={directionGenerating}
                  className="gap-1.5 text-xs"
                >
                  {directionGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  Regenerar dirección visual (nuevo concepto)
                </Button>
                <p className="text-gray-400">
                  Propone otro concepto (no solo otra redacción) — después usá &ldquo;{displayedVisualUrl ? "Regenerar placa" : "Generar placa final"}&rdquo; para renderizarlo.
                </p>
                {directionError && <p className="text-red-600">{directionError}</p>}
              </div>
            </details>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-gray-900">Texto alternativo de la imagen</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={regenerateAltText}
                  disabled={altTextGenerating}
                  className="h-auto gap-1.5 px-2 py-1 text-xs text-violet-700 hover:text-violet-800"
                >
                  {altTextGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  Regenerar
                </Button>
              </div>
              <Input
                value={item.image_alt_text ?? ""}
                maxLength={180}
                onChange={event => onChange({ ...item, image_alt_text: event.target.value })}
                placeholder="Descripción breve para accesibilidad"
                className="bg-white text-gray-900"
              />
              {altTextError && <p className="text-xs text-red-600">{altTextError}</p>}
            </div>
          </CardContent>
        </Card>
        <Button variant="outline" onClick={onCopy} className="w-full gap-2">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar Instagram</Button>
        <TrackedLinkField itemId={item.id} visits={item.tracked_visits ?? 0} interactions={item.tracked_interactions ?? 0} />
        {item.source && (
          <a href={item.source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
            <span className="font-medium">Fuente revisada:</span> {item.source.title} <ExternalLink className="inline h-3 w-3" />
          </a>
        )}
      </div>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Revisión humana</CardTitle>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && <Badge variant="warning">Cambios sin guardar</Badge>}
              <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
            </div>
          </div>
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Verificá que no haya diagnósticos, tratamientos, interpretación de estudios ni promesas. Ante síntomas de alarma, derivá a guardia.</span>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-semibold">Checklist de captación</p>
            <ul className="mt-2 space-y-1">
              <li>• ¿El hook se entiende y despierta curiosidad en menos de 3 segundos?</li>
              <li>• ¿La imagen conecta con una situación o aspiración reconocible?</li>
              <li>• ¿La pieza entrega valor antes de invitar a pedir turno?</li>
              <li>• ¿El CTA explica un próximo paso simple, sin miedo ni presión?</li>
            </ul>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isHistoria && !showHistoriaText && (
            <div className="text-xs text-gray-500 rounded-md bg-gray-50 border border-gray-200 p-2 space-y-1.5">
              <p>Instagram no muestra caption ni hashtags en historias (solo la imagen) — no hace falta escribir nada acá, subí la imagen y aprobá.</p>
              <button type="button" onClick={() => setShowHistoriaText(true)} className="font-medium text-gray-700 hover:text-gray-900 underline">
                Agregar texto de referencia interna (opcional)
              </button>
            </div>
          )}
          {(!isHistoria || showHistoriaText) && (
            <>
              {isHistoria && (
                <p className="text-xs text-gray-500 rounded-md bg-gray-50 border border-gray-200 p-2">
                  Instagram no muestra caption ni hashtags en historias (solo la imagen) — completar estos campos es opcional, quedan como referencia interna.
                </p>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><Label className="text-gray-900">Hook{isHistoria ? " (referencia interna)" : " de Instagram"}</Label><CharacterCount value={item.hook} /></div>
                <Textarea rows={2} value={item.hook} onChange={event => onChange({ ...item, hook: event.target.value })} className="text-gray-900" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><Label className="text-gray-900">Caption{isHistoria ? " (referencia interna)" : " de Instagram"}</Label><CharacterCount value={item.caption} /></div>
                <Textarea rows={9} value={item.caption} onChange={event => onChange({ ...item, caption: event.target.value })} className="text-gray-900" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><Label className="text-gray-900">Hashtags{isHistoria ? " (referencia interna)" : ""}</Label><CharacterCount value={item.hashtags} /></div>
                <Textarea rows={3} value={item.hashtags} onChange={event => onChange({ ...item, hashtags: event.target.value })} className="text-gray-900" />
              </div>
            </>
          )}
          {item.slides && item.slides.length > 0 && (
            <div className="space-y-3 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Slides del carrusel</p>
              {item.slides.map((slide, index) => (
                <div key={index} className="space-y-2 rounded-md bg-gray-50 p-3">
                  <Label className="text-gray-900">Slide {index + 1}</Label>
                  <Input value={slide.headline} maxLength={60} onChange={event => updateSlide(index, { headline: event.target.value })} className="bg-white text-gray-900" />
                  <Textarea rows={3} value={slide.text} maxLength={300} onChange={event => updateSlide(index, { text: event.target.value })} className="bg-white text-gray-900" />
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button variant="outline" onClick={() => onSave(editableContent(item))} disabled={busy || !hasUnsavedChanges} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar cambios
            </Button>
            {item.status === "draft" && (
              <Button onClick={() => onSave({ ...editableContent(item), status: "approved" })} disabled={busy || !approvalReady} className="gap-2">
                <Check className="h-4 w-4" /> Aprobar
              </Button>
            )}
            {item.status === "approved" && (
              <Button
                variant="outline"
                onClick={() => onSave({ status: "draft" })}
                disabled={busy}
                className="gap-2"
                title="Vuelve a borrador para poder editarla sin que se publique sola mientras tanto"
              >
                <Undo2 className="h-4 w-4" /> Volver a borrador
              </Button>
            )}
            {item.status === "approved" && item.channels.length > 0 && (
              <Button
                onClick={onPublishNow}
                disabled={busy}
                className="gap-2"
                title="Publica ya mismo en Instagram"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publicar ahora
              </Button>
            )}
            {item.status === "approved" && igConnected && (() => {
              const formatSupported = item.format === "post" || item.format === "historia"
              const disabledReason = !formatSupported
                ? "Este formato no publica directo (requiere video o varias imágenes). Copiá el contenido y publicalo manualmente."
                : !displayedVisualUrl
                  ? "Generá la placa final primero"
                  : undefined
              return (
                <Button
                  variant="outline"
                  onClick={onPublishInstagram}
                  disabled={busy || !formatSupported || !displayedVisualUrl}
                  className="gap-2"
                  title={disabledReason}
                >
                  <Send className="h-4 w-4" /> Publicar solo en Instagram
                </Button>
              )
            })()}
            {item.status === "published" && (
              <Button
                variant="outline"
                onClick={() => {
                  if (!window.confirm("Esto NO borra la publicación real en Instagram — solo devuelve esta pieza a \"aprobada\" acá en el sistema para poder corregirla y volver a publicar. Si necesitás borrar el posteo real, hacelo a mano desde la app. ¿Continuar?")) return
                  onSave({ status: "approved", auto_publish_result: {} })
                }}
                disabled={busy}
                className="gap-2"
                title="Vuelve la pieza a 'aprobada' para corregirla. No borra la publicación real en Instagram — eso se hace a mano desde la app."
              >
                <Undo2 className="h-4 w-4" /> Deshacer publicación
              </Button>
            )}
          </div>
          {!approvalReady && item.status === "draft" && (
            <p className="text-xs text-amber-700">
              {isHistoria
                ? "Para aprobar, agregá un titular visual o subí una imagen propia."
                : "Para aprobar, completá hook y caption, y agregá un titular visual o subí una imagen propia."}
            </p>
          )}
          <p className="text-xs text-gray-500">
            {igConnected
              ? "Instagram publica posts e historias con la placa generada (conectá y generá la placa final antes). Reels y carruseles todavia requieren copiar/publicar manualmente."
              : "Conectá Instagram arriba para publicar posts e historias directamente."}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
