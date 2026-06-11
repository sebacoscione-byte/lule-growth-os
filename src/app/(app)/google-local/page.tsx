"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Circle, Loader2, Sparkles, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const CHECKLIST_ITEMS = [
  { key: "nombre_correcto", label: "Nombre: Dra. Lucía Chahin", desc: "Sin palabras clave en el nombre" },
  { key: "categoria_principal", label: "Categoría: Cardióloga / Médico", desc: "Categoría principal configurada" },
  { key: "ubicacion_cimel", label: "Ubicación: CIMEL Lanús (Tucumán 1314)", desc: "Primera ficha con CIMEL Lanús" },
  { key: "horario_real", label: "Horario real de atención (martes)", desc: "Solo martes, no toda la semana" },
  { key: "servicios_cargados", label: "Servicios cargados", desc: "Consulta cardiológica, Ecocardiograma" },
  { key: "descripcion_cargada", label: "Descripción cargada", desc: "Clara, sin promesas médicas" },
  { key: "fotos_profesionales", label: "Fotos profesionales subidas", desc: "Sin pacientes, ambientación clínica" },
  { key: "link_landing", label: "Link a landing propia", desc: "/landings/dra-lucia-chahin" },
  { key: "telefono_configurado", label: "Teléfono o instrucciones configuradas", desc: "Solo si permite pedir turno con Lucía" },
  { key: "primera_publicacion", label: "Primera publicación creada", desc: "Post sobre servicios o días de atención" },
  { key: "preguntas_frecuentes", label: "Preguntas frecuentes respondidas", desc: "FAQ básica configurada en la ficha" },
]

const GOOGLE_DESCRIPTION = `La Dra. Lucía Chahin es médica cardióloga. Atiende consultas de cardiología y realiza ecocardiogramas.

Actualmente atiende los martes en CIMEL Lanús y los viernes en Swiss Medical Lomas.

Para solicitar turno, comunicate con la institución correspondiente y pedí atención con la Dra. Lucía Chahin.

Este perfil no debe utilizarse para urgencias médicas. Ante síntomas de alarma, concurrí a una guardia o buscá atención médica inmediata.`

const GOOGLE_POSTS = [
  {
    title: "Consulta cardiológica (CIMEL Lanús)",
    text: `Consulta cardiológica con la Dra. Lucía Chahin

La Dra. Lucía Chahin atiende consultas de cardiología los martes en CIMEL Lanús.

Para pedir turno, comunicate con CIMEL y solicitá atención con la Dra. Lucía Chahin.`,
  },
  {
    title: "Ecocardiogramas",
    text: `Ecocardiogramas con la Dra. Lucía Chahin

La Dra. Lucía Chahin realiza ecocardiogramas.
Atiende los martes en CIMEL Lanús y los viernes en Swiss Medical Lomas.

Para pedir turno, comunicate con la institución correspondiente y solicitá atención con la Dra. Lucía Chahin.`,
  },
  {
    title: "Atención en Lanús y Lomas",
    text: `Atención cardiológica en Lanús y Lomas

La Dra. Lucía Chahin atiende:
- Martes en CIMEL Lanús
- Viernes en Swiss Medical Lomas

Consultas de cardiología y ecocardiogramas disponibles en ambas sedes.`,
  },
]

export default function GoogleLocalPage() {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [customTopic, setCustomTopic] = useState("")
  const [generatedPost, setGeneratedPost] = useState("")
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/checklist")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: Record<string, boolean> = {}
          data.forEach((item: { item_key: string; completed: boolean }) => {
            map[item.item_key] = item.completed
          })
          setChecklist(map)
        }
      })
      .catch(() => {})
  }, [])

  async function toggleItem(key: string) {
    setSaving(key)
    const newVal = !checklist[key]
    setChecklist(prev => ({ ...prev, [key]: newVal }))
    await fetch("/api/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: key, completed: newVal }),
    }).catch(() => {})
    setSaving(null)
  }

  async function generatePost() {
    if (!customTopic) return
    setGenerating(true)
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "google_post", topic: customTopic }),
    })
    const data = await res.json()
    setGeneratedPost(data.text ?? "")
    setGenerating(false)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const completedCount = CHECKLIST_ITEMS.filter(i => checklist[i.key]).length
  const progress = Math.round((completedCount / CHECKLIST_ITEMS.length) * 100)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google Local</h1>
        <p className="text-sm text-gray-500">Optimización de ficha profesional y contenido</p>
      </div>

      <Tabs defaultValue="checklist">
        <TabsList>
          <TabsTrigger value="checklist">Checklist de ficha</TabsTrigger>
          <TabsTrigger value="descripcion">Descripción</TabsTrigger>
          <TabsTrigger value="publicaciones">Publicaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="checklist" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Ficha profesional — Dra. Lucía Chahin</span>
                <span className="text-sm font-normal text-gray-500">{completedCount}/{CHECKLIST_ITEMS.length} ({progress}%)</span>
              </CardTitle>
              <div className="h-2 bg-gray-100 rounded-full mt-2">
                <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => toggleItem(item.key)}
                  className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 text-left transition-colors"
                >
                  {saving === item.key ? (
                    <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                  ) : checklist[item.key] ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className={`text-sm font-medium ${checklist[item.key] ? "text-gray-500 line-through" : "text-gray-900"}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="descripcion" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Descripción sugerida para Google
                <Button variant="outline" size="sm" onClick={() => copy(GOOGLE_DESCRIPTION, "desc")}>
                  {copied === "desc" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  Copiar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 rounded-lg p-4 font-sans">
                {GOOGLE_DESCRIPTION}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="publicaciones" className="mt-4 space-y-4">
          {GOOGLE_POSTS.map((post, i) => (
            <Card key={i}>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  {post.title}
                  <Button variant="outline" size="sm" onClick={() => copy(post.text, `post-${i}`)}>
                    {copied === `post-${i}` ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    Copiar
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 rounded-lg p-4 font-sans">
                  {post.text}
                </pre>
              </CardContent>
            </Card>
          ))}

          {/* Generador personalizado */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generar publicación personalizada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Tema (ej: control de presión arterial, arritmias)"
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                />
                <Button onClick={generatePost} disabled={!customTopic || generating}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generar
                </Button>
              </div>
              {generatedPost && (
                <div className="relative">
                  <Textarea value={generatedPost} readOnly rows={6} className="bg-gray-50" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copy(generatedPost, "generated")}
                  >
                    {copied === "generated" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
