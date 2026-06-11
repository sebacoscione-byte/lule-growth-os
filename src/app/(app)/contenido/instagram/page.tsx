"use client"

import { useState } from "react"
import { Sparkles, Copy, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const CATEGORIES = [
  "Consulta cardiológica",
  "Ecocardiograma",
  "Presión arterial",
  "Colesterol",
  "Palpitaciones",
  "Chequeo cardiovascular",
  "Factores de riesgo",
  "Qué llevar a una consulta cardiológica",
  "Atención en Lanús (CIMEL)",
  "Atención en Lomas (Swiss Medical)",
  "Cómo pedir turno con la Dra. Lucía Chahin",
]

const CTA_OPTIONS = [
  "Escribí CARDIO y te paso cómo pedir turno",
  "Escribí ECO si necesitás un ecocardiograma",
  "Escribí TURNO y te paso las opciones de atención",
  "Atiende martes en Lanús y viernes en Lomas",
]

const CONTENT_TYPES = [
  { value: "reel", label: "Reel" },
  { value: "historia", label: "Historia" },
  { value: "carrusel", label: "Carrusel" },
  { value: "post", label: "Post estático" },
]

const CALENDAR_ITEMS = [
  { day: "Lunes", theme: "Control cardiológico preventivo" },
  { day: "Martes", theme: "Recordatorio atención CIMEL Lanús" },
  { day: "Miércoles", theme: "Educación cardiológica" },
  { day: "Jueves", theme: "Recordatorio Swiss Medical Lomas" },
  { day: "Viernes", theme: "Ecocardiograma / atención en Swiss" },
  { day: "Sábado", theme: "FAQ, prevención o resumen semanal" },
]

interface GeneratedContent {
  caption: string
  hook: string
  hashtags: string
}

export default function InstagramPage() {
  const [category, setCategory] = useState("")
  const [contentType, setContentType] = useState("reel")
  const [cta, setCta] = useState(CTA_OPTIONS[0])
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedContent | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function generate() {
    if (!category) return
    setGenerating(true)
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "instagram", category, content_type: contentType, cta }),
    })
    const data = await res.json()
    setResult(data)
    setGenerating(false)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Contenido Instagram</h1>
        <p className="text-sm text-gray-500">Generador de contenido para captación de pacientes</p>
      </div>

      <Tabs defaultValue="generador">
        <TabsList>
          <TabsTrigger value="generador">Generador</TabsTrigger>
          <TabsTrigger value="calendario">Calendario sugerido</TabsTrigger>
          <TabsTrigger value="ctas">CTAs sugeridos</TabsTrigger>
        </TabsList>

        <TabsContent value="generador" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Configurar contenido</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Categoría / tema</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue placeholder="Elegí un tema..." /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Tipo de contenido</Label>
                  <Select value={contentType} onValueChange={setContentType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>CTA</Label>
                  <Select value={cta} onValueChange={setCta}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CTA_OPTIONS.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={generate} disabled={!category || generating} className="w-full">
                  {generating
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Generando...</>
                    : <><Sparkles className="h-4 w-4" /> Generar contenido</>
                  }
                </Button>
              </CardContent>
            </Card>

            {result && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      Hook (apertura)
                      <Button variant="ghost" size="icon" onClick={() => copy(result.hook, "hook")}>
                        {copied === "hook" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{result.hook}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      Caption completo
                      <Button variant="ghost" size="icon" onClick={() => copy(result.caption, "caption")}>
                        {copied === "caption" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea value={result.caption} readOnly rows={8} className="bg-gray-50" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      Hashtags
                      <Button variant="ghost" size="icon" onClick={() => copy(result.hashtags, "hashtags")}>
                        {copied === "hashtags" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-blue-600 bg-blue-50 rounded-lg p-3">{result.hashtags}</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="calendario" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calendario de contenido sugerido</CardTitle>
              <p className="text-sm text-gray-500">Frecuencia mínima: 3 reels + 2 historias + 1 carrusel por semana</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {CALENDAR_ITEMS.map(item => (
                  <div key={item.day} className="flex items-center gap-4 p-3 rounded-lg bg-gray-50">
                    <div className="w-20 text-sm font-medium text-gray-900">{item.day}</div>
                    <div className="flex-1 text-sm text-gray-600">{item.theme}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCategory(item.theme)}
                    >
                      Usar tema
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ctas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CTAs sugeridos para publicaciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {CTA_OPTIONS.map((cta, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-700">{cta}</p>
                  <Button variant="ghost" size="icon" onClick={() => copy(cta, `cta-${i}`)}>
                    {copied === `cta-${i}` ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
