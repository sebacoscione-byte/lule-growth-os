"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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

const CATEGORIES = [
  "Consulta cardiologica", "Ecocardiograma", "Presion arterial", "Colesterol",
  "Palpitaciones", "Chequeo cardiovascular", "Factores de riesgo",
  "Atencion en Lanus", "Atencion en Lomas", "Como pedir turno",
]

const CTA_OPTIONS = [
  "Escribi CARDIO y te paso como pedir turno",
  "Escribi ECO si necesitas un ecocardiograma",
  "Escribi TURNO y te paso las opciones de atencion",
  "Atiende martes en Lanus y viernes en Lomas",
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

export default function ContentStudioPage() {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [topic, setTopic] = useState("")
  const [format, setFormat] = useState<ContentItem["format"]>("reel")
  const [cta, setCta] = useState(CTA_OPTIONS[0])
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

  const loadItems = useCallback(async () => {
    const response = await fetch("/api/content/items")
    const data = await response.json()
    if (data.error) setError(data.error)
    else setItems(data.items ?? [])
    setLoadingItems(false)
  }, [])

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setGenerating(true)
    setError(null)
    const response = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "content_plan",
        topic: topic || category,
        category,
        content_type: format,
        cta,
        source: selectedSource,
      }),
    })
    const generated = await response.json()
    if (!response.ok || generated.error) {
      setGenerating(false)
      return setError(generated.error ?? "No se pudo generar el contenido")
    }

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
      ...generated,
    }
    const saved = await fetch("/api/content/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
    setGenerating(false)
    if (!saved.ok) return setError("Se genero el contenido, pero no se pudo guardar")
    setItems(previous => [item, ...previous])
    setActive(item)
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
          <p className="text-sm text-gray-500">Investiga, genera, revisa y aprueba contenido para Instagram y Google.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{counts.draft} borradores</Badge>
          <Badge variant="outline" className="border-green-300 text-green-700">{counts.approved} aprobados</Badge>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="crear">Crear con IA</TabsTrigger>
          <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger>
        </TabsList>

        <TabsContent value="crear" className="mt-4">
          <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
            <Card>
              <CardHeader><CardTitle className="text-base">Brief editorial</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Tema o enfoque</Label>
                  <Input value={topic} onChange={event => setTopic(event.target.value)} placeholder="Ej: novedades sobre control de presion" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Formato</Label>
                    <Select value={format} onValueChange={value => setFormat(value as ContentItem["format"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FORMATS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>CTA</Label>
                    <Select value={cta} onValueChange={setCta}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CTA_OPTIONS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="outline" onClick={research} disabled={researching} className="w-full">
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
                <Button onClick={generate} disabled={generating} className="w-full">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generar propuesta completa
                </Button>
                <p className="text-xs text-gray-500">La IA crea texto para ambos canales y una placa visual descargable. Todo queda como borrador hasta tu aprobacion.</p>
              </CardContent>
            </Card>

            {active ? <Editor item={active} working={working} copied={copied} onChange={setActive}
              onSave={changes => updateItem(active, changes)} onCopy={() => copyInstagram(active)}
              onDownload={() => downloadVisual(active)} onPublishGoogle={() => publishGoogle(active)} />
              : <Card className="flex min-h-[420px] items-center justify-center"><CardContent className="text-center text-sm text-gray-500">
                <Sparkles className="mx-auto mb-3 h-7 w-7 text-gray-300" />
                Genera una propuesta o abri un borrador de la biblioteca.
              </CardContent></Card>}
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
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setActive(item); setTab("crear") }}><BookOpen className="h-4 w-4" /> Abrir</Button>
                      <Button variant="ghost" size="icon" onClick={() => updateItem(item, { status: "archived" })}><Archive className="h-4 w-4" /></Button>
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
          <Button variant="outline" onClick={onDownload} className="flex-1"><Download className="h-4 w-4" /> Descargar placa</Button>
          <Button variant="outline" onClick={onCopy} className="flex-1">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copiar Instagram</Button>
        </div>
        {item.source && <a href={item.source.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
          <span className="font-medium">Fuente revisada:</span> {item.source.title} <ExternalLink className="inline h-3 w-3" />
        </a>}
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Revision humana</CardTitle>
          <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5"><Label>Instagram</Label><Textarea rows={9} value={item.caption} onChange={event => onChange({ ...item, caption: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>Google Business</Label><Textarea rows={6} value={item.google_text} onChange={event => onChange({ ...item, google_text: event.target.value })} /></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onSave({ caption: item.caption, google_text: item.google_text })} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Guardar cambios
            </Button>
            {item.status !== "approved" && <Button onClick={() => onSave({ status: "approved", caption: item.caption, google_text: item.google_text })} disabled={busy}><Check className="h-4 w-4" /> Aprobar</Button>}
            {item.status === "approved" && <Button onClick={onPublishGoogle} disabled={busy}><Send className="h-4 w-4" /> Publicar en Google</Button>}
          </div>
          <p className="text-xs text-gray-500">Instagram requiere copiar/publicar manualmente hasta conectar Instagram Graph API. Google publica solo despues de aprobar y si la API de la cuenta lo permite.</p>
        </CardContent>
      </Card>
    </div>
  )
}
