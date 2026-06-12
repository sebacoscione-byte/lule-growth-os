"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Archive, BookOpen, Check, Copy, Download, ExternalLink, Loader2,
  RefreshCw, Search, Send, Sparkles,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { ContentItem, ContentSource, ContentStatus } from "@/types"

const IS_MANUAL_MODE = process.env.NEXT_PUBLIC_AI_MODE !== "gemini_api"

const CATEGORIES = [
  "Consulta cardiologica", "Ecocardiograma", "Presion arterial", "Colesterol",
  "Palpitaciones", "Chequeo cardiovascular", "Factores de riesgo",
  "Atencion en Lanus", "Atencion en Lomas", "Como pedir turno",
]

const CTA_OPTIONS = [
  "",
  "Link en la bio para pedir turno",
  "Link en la bio → turnos en CIMEL Lanús (martes)",
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

function VisualCard({ item, compact = false }: { item: ContentItem; compact?: boolean }) {
  return (
    <div className={`aspect-square rounded-2xl bg-gradient-to-br ${STYLE_CLASSES[item.visual_style]} p-6 text-white flex flex-col justify-between shadow-sm`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/75">
        <span>Cardiologia</span>
        <span>Dra. Lucia Chahin</span>
      </div>
      <div>
        <p className={`${compact ? "text-xl" : "text-3xl"} font-bold leading-tight`}>{item.visual_headline}</p>
        <p className="mt-3 text-sm text-white/80">{item.visual_subtitle}</p>
      </div>
      <p className="text-xs text-white/70">Martes en Lanus · Viernes en Lomas</p>
    </div>
  )
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, char => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[char]!)
}

function wrapText(value: string, max = 27) {
  const words = value.split(/\s+/)
  const lines: string[] = []
  words.forEach(word => {
    const current = lines[lines.length - 1]
    if (!current || `${current} ${word}`.length > max) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  })
  return lines.slice(0, 5)
}

function downloadVisual(item: ContentItem) {
  const colors = {
    rose: ["#e11d48", "#831843"],
    blue: ["#2563eb", "#0f172a"],
    teal: ["#0d9488", "#164e63"],
  }[item.visual_style]
  const headline = wrapText(item.visual_headline)
    .map((line, index) => `<text x="72" y="${420 + index * 88}" font-size="68" font-weight="700" fill="white">${escapeXml(line)}</text>`)
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <rect width="1080" height="1080" rx="48" fill="url(#g)"/>
    <text x="72" y="90" font-size="24" letter-spacing="5" fill="white" opacity=".75">CARDIOLOGIA</text>
    <text x="1008" y="90" text-anchor="end" font-size="24" fill="white" opacity=".75">Dra. Lucia Chahin</text>
    ${headline}
    <text x="72" y="880" font-size="30" fill="white" opacity=".82">${escapeXml(item.visual_subtitle.slice(0, 58))}</text>
    <text x="72" y="1000" font-size="24" fill="white" opacity=".72">Martes en Lanus · Viernes en Lomas</text>
  </svg>`
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
  link.download = `lule-${item.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`
  link.click()
  URL.revokeObjectURL(link.href)
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
// Main page
// ---------------------------------------------------------------------------

export default function ContentStudioPage() {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [topic, setTopic] = useState("")
  const [format, setFormat] = useState<ContentItem["format"]>("reel")
  const [cta, setCta] = useState("")
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

  const lastGenRef = useRef(0)

  const loadItems = useCallback(async () => {
    const response = await fetch("/api/content/items")
    const data = await response.json()
    if (data.error) setError(data.error)
    else setItems(data.items ?? [])
    setLoadingItems(false)
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const counts = useMemo(() => ({
    draft: items.filter(item => item.status === "draft").length,
    approved: items.filter(item => item.status === "approved").length,
  }), [items])

  async function research() {
    setResearching(true)
    setError(null)
    setSelectedSource(null)
    const response = await fetch(`/api/content/sources?topic=${encodeURIComponent(topic || category)}`)
    const data = await response.json()
    setResearching(false)
    if (data.error) return setError(data.error)
    setSources(data.sources ?? [])
    setSelectedSource(data.sources?.[0] ?? null)
  }

  async function generate() {
    // Debounce: ignore if clicked within 2s of previous attempt
    const now = Date.now()
    if (now - lastGenRef.current < 2000) return
    lastGenRef.current = now

    setGenerating(true)
    setError(null)
    setManualPrompt(null)

    const response = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "content_plan",
        topic: topic || category,
        category,
        content_type: format,
        cta,
        appointment_link: appointmentLink.trim() || null,
        source: selectedSource,
      }),
    })
    const generated = await response.json()
    setGenerating(false)

    // Rate limit fallback: show manual panel with the prompt
    if (response.status === 429 && generated.prompt) {
      setError(generated.error)
      setManualPrompt(generated.prompt)
      return
    }

    if (!response.ok || generated.error) {
      return setError(generated.error ?? "No se pudo generar el contenido")
    }

    // Manual mode: show prompt panel
    if (generated.mode === "manual") {
      setManualPrompt(generated.prompt)
      return
    }

    // API mode: create content item directly
    await saveGeneratedItem(generated)
  }

  async function saveGeneratedItem(generated: Record<string, unknown>) {
    const now = new Date().toISOString()
    const item: ContentItem = {
      id: crypto.randomUUID(),
      topic: topic || category,
      category,
      format,
      goal: "Captar consultas y explicar como pedir turno",
      status: "draft",
      channels: ["instagram", "google_business"],
      source: selectedSource,
      created_at: now,
      updated_at: now,
      approved_at: null,
      hook: generated.hook as string,
      caption: generated.caption as string,
      google_text: (generated.google_text as string).slice(0, 1500),
      hashtags: generated.hashtags as string,
      visual_headline: (generated.visual_headline as string).slice(0, 90),
      visual_subtitle: (generated.visual_subtitle as string).slice(0, 90),
      visual_style: (["rose", "blue", "teal"].includes(generated.visual_style as string)
        ? generated.visual_style
        : "blue") as "rose" | "blue" | "teal",
    }

    const saved = await fetch("/api/content/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
    if (!saved.ok) {
      setError("Se genero el contenido pero no se pudo guardar")
      return
    }
    setItems(previous => [item, ...previous])
    setActive(item)
    setManualPrompt(null)
  }

  async function processManualResponse(pasted: string) {
    const jsonMatch = pasted.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No se encontró JSON válido. Asegurate de copiar la respuesta completa de la IA.")

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error("El JSON pegado tiene un error de formato. Intentá copiar la respuesta nuevamente.")
    }

    const required = ["hook", "caption", "google_text", "hashtags", "visual_headline", "visual_subtitle"]
    const missing = required.filter(k => typeof parsed[k] !== "string")
    if (missing.length > 0) {
      throw new Error(`Faltan campos en la respuesta: ${missing.join(", ")}. Pedile a la IA que devuelva el JSON completo.`)
    }

    await saveGeneratedItem(parsed)
  }

  async function updateItem(item: ContentItem, changes: Partial<ContentItem>) {
    setWorking(item.id)
    const response = await fetch("/api/content/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, ...changes }),
    })
    const data = await response.json()
    setWorking(null)
    if (data.error) return setError(data.error)
    setItems(previous => previous.map(existing => existing.id === item.id ? data.item : existing))
    setActive(data.item)
  }

  async function publishGoogle(item: ContentItem) {
    setWorking(item.id)
    const response = await fetch("/api/google-business/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: item.google_text }),
    })
    const data = await response.json()
    setWorking(null)
    if (!response.ok || data.error) return setError(data.error ?? "Google no permitio publicar")
    await updateItem(item, { status: "published" })
  }

  async function copyInstagram(item: ContentItem) {
    await navigator.clipboard.writeText(`${item.hook}\n\n${item.caption}\n\n${item.hashtags}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estudio de contenido</h1>
          <p className="text-sm text-gray-500">
            {IS_MANUAL_MODE
              ? "Generá prompts listos para ChatGPT, Gemini o Claude. Sin costo."
              : "Investigá, generá, revisá y aprobá contenido para Instagram y Google."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {IS_MANUAL_MODE && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              Modo manual
            </Badge>
          )}
          <Badge variant="outline">{counts.draft} borradores</Badge>
          <Badge variant="outline" className="border-green-300 text-green-700">{counts.approved} aprobados</Badge>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="crear">{IS_MANUAL_MODE ? "Preparar prompt" : "Crear con IA"}</TabsTrigger>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
        </TabsList>

        <TabsContent value="crear" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
            {/* Left: brief form */}
            <Card>
              <CardHeader><CardTitle className="text-base">Brief editorial</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-gray-900">Categoria</Label>
                  <Input
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    list="categories-list"
                    placeholder="Seleccioná o escribí una categoría"
                    className="text-gray-900 placeholder:text-gray-400"
                  />
                  <datalist id="categories-list">
                    {CATEGORIES.map(value => <option key={value} value={value} />)}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-900">Tema o enfoque</Label>
                  <Input value={topic} onChange={event => setTopic(event.target.value)} placeholder="Ej: novedades sobre control de presion" className="text-gray-900 placeholder:text-gray-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-gray-900">Formato</Label>
                    <Select value={format} onValueChange={value => setFormat(value as ContentItem["format"])}>
                      <SelectTrigger className="text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>{FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-900">CTA <span className="text-gray-400 font-normal">(opcional)</span></Label>
                    <Select value={cta} onValueChange={setCta}>
                      <SelectTrigger className="text-gray-900">
                        <SelectValue placeholder="Sin llamado a acción" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sin llamado a acción</SelectItem>
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
                  <p className="text-xs text-gray-400">Si no tenés link todavía, dejalo vacío y el prompt usará "link en la bio".</p>
                </div>
                <Button variant="outline" onClick={research} disabled={researching} className="w-full gap-2">
                  {researching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar informacion reciente
                </Button>
                {sources.length > 0 && (
                  <div className="space-y-2">
                    <Label>Fuente para fundamentar el contenido</Label>
                    {sources.slice(0, 3).map(source => (
                      <button key={source.url} onClick={() => setSelectedSource(source)}
                        className={`w-full rounded-lg border p-3 text-left text-xs ${selectedSource?.url === source.url ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                        <span className="font-medium text-gray-800 line-clamp-2">{source.title}</span>
                        <span className="mt-1 block text-gray-500">{source.publication} · {source.published_at}</span>
                      </button>
                    ))}
                  </div>
                )}
                <Button onClick={generate} disabled={generating} className="w-full gap-2">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {IS_MANUAL_MODE ? "Preparar prompt para copiar" : "Generar propuesta completa"}
                </Button>
                <p className="text-xs text-gray-500">
                  {IS_MANUAL_MODE
                    ? "Se genera el prompt listo para pegar en ChatGPT, Gemini o Claude. Vos pegás la respuesta y la app la guarda."
                    : "La IA crea texto para ambos canales y una placa visual descargable. Todo queda como borrador hasta tu aprobacion."}
                </p>
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
                onChange={setActive}
                onSave={changes => updateItem(active, changes)}
                onCopy={() => copyInstagram(active)}
                onDownload={() => downloadVisual(active)}
                onPublishGoogle={() => publishGoogle(active)}
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

        <TabsContent value="biblioteca" className="mt-4">
          {loadingItems ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-gray-400" /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.filter(item => item.status !== "archived").map(item => (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-4 space-y-3">
                    <VisualCard item={item} compact />
                    <div className="flex items-center justify-between gap-2">
                      <div><p className="font-medium text-gray-900">{item.topic}</p><p className="text-xs text-gray-500">{item.format} · {new Date(item.created_at).toLocaleDateString("es-AR")}</p></div>
                      <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setActive(item); setManualPrompt(null); setTab("crear") }}>
                        <BookOpen className="h-4 w-4" /> Abrir
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => updateItem(item, { status: "archived" })}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

function Editor({ item, working, copied, onChange, onSave, onCopy, onDownload, onPublishGoogle }: {
  item: ContentItem
  working: string | null
  copied: boolean
  onChange: (item: ContentItem) => void
  onSave: (changes: Partial<ContentItem>) => void
  onCopy: () => void
  onDownload: () => void
  onPublishGoogle: () => void
}) {
  const busy = working === item.id
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <VisualCard item={item} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDownload} className="flex-1 gap-2"><Download className="h-4 w-4" /> Descargar placa</Button>
          <Button variant="outline" onClick={onCopy} className="flex-1 gap-2">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar Instagram</Button>
        </div>
        {item.source && (
          <a href={item.source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
            <span className="font-medium">Fuente revisada:</span> {item.source.title} <ExternalLink className="inline h-3 w-3" />
          </a>
        )}
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Revision humana</CardTitle>
          <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label className="text-gray-900">Instagram</Label><Textarea rows={9} value={item.caption} onChange={event => onChange({ ...item, caption: event.target.value })} className="text-gray-900" /></div>
          <div className="space-y-1.5"><Label className="text-gray-900">Google Business</Label><Textarea rows={6} value={item.google_text} onChange={event => onChange({ ...item, google_text: event.target.value })} className="text-gray-900" /></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onSave({ caption: item.caption, google_text: item.google_text })} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Guardar cambios
            </Button>
            {item.status !== "approved" && (
              <Button onClick={() => onSave({ status: "approved", caption: item.caption, google_text: item.google_text })} disabled={busy} className="gap-2">
                <Check className="h-4 w-4" /> Aprobar
              </Button>
            )}
            {item.status === "approved" && (
              <Button onClick={onPublishGoogle} disabled={busy} className="gap-2">
                <Send className="h-4 w-4" /> Publicar en Google
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500">Instagram requiere copiar/publicar manualmente hasta conectar Instagram Graph API. Google publica solo despues de aprobar y si la API de la cuenta lo permite.</p>
        </CardContent>
      </Card>
    </div>
  )
}
