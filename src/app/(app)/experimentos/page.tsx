"use client"

import { useEffect, useState } from "react"
import { Plus, Trophy, FlaskConical, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { GrowthExperiment } from "@/types"

const CHANNELS = [
  { value: "google_maps", label: "Google Maps" },
  { value: "seo", label: "SEO" },
  { value: "instagram", label: "Instagram" },
  { value: "google_ads", label: "Google Ads" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referrals", label: "Referidos" },
]

const EMPTY_FORM = {
  name: "",
  channel: "instagram",
  hypothesis: "",
  content_or_action: "",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
  metric_to_improve: "",
}

export default function ExperimentosPage() {
  const [experiments, setExperiments] = useState<GrowthExperiment[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    fetch("/api/experiments")
      .then(r => r.json())
      .then(data => {
        setExperiments(Array.isArray(data) ? data : [])
        setLoading(false)
      })
  }, [])

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch("/api/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    const exp = await res.json()
    setExperiments(prev => [exp, ...prev])
    setForm(EMPTY_FORM)
    setShowForm(false)
    setSaving(false)
  }

  async function updateResult(id: string, result: string, winner: boolean) {
    await fetch(`/api/experiments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, winner }),
    })
    setExperiments(prev => prev.map(e => e.id === id ? { ...e, result, winner } : e))
  }

  const active = experiments.filter(e => !e.end_date || new Date(e.end_date) >= new Date())
  const finished = experiments.filter(e => e.end_date && new Date(e.end_date) < new Date())

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Experimentos de crecimiento</h1>
          <p className="text-sm text-gray-500">{experiments.length} experimentos registrados</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" />
          Nuevo experimento
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nuevo experimento</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nombre</Label>
                  <Input placeholder="Ej: Landing cardióloga Lanús" value={form.name} onChange={e => update("name", e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Canal</Label>
                  <Select value={form.channel} onValueChange={v => update("channel", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Hipótesis</Label>
                <Textarea placeholder="Si hacemos X, entonces Y porque Z" value={form.hypothesis} onChange={e => update("hypothesis", e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Acción / contenido</Label>
                <Textarea placeholder="Qué vas a hacer exactamente" value={form.content_or_action} onChange={e => update("content_or_action", e.target.value)} required />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Fecha inicio</Label>
                  <Input type="date" value={form.start_date} onChange={e => update("start_date", e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Fecha fin</Label>
                  <Input type="date" value={form.end_date} onChange={e => update("end_date", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Métrica a mejorar</Label>
                  <Input placeholder="leads desde Google Maps" value={form.metric_to_improve} onChange={e => update("metric_to_improve", e.target.value)} required />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-blue-500" />
                Activos ({active.length})
              </h2>
              <div className="space-y-3">
                {active.map(exp => <ExperimentCard key={exp.id} exp={exp} onUpdateResult={updateResult} />)}
              </div>
            </div>
          )}

          {finished.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                Finalizados ({finished.length})
              </h2>
              <div className="space-y-3">
                {finished.map(exp => <ExperimentCard key={exp.id} exp={exp} onUpdateResult={updateResult} />)}
              </div>
            </div>
          )}

          {experiments.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No hay experimentos todavía</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ExperimentCard({
  exp,
  onUpdateResult,
}: {
  exp: GrowthExperiment
  onUpdateResult: (id: string, result: string, winner: boolean) => void
}) {
  const [result, setResult] = useState(exp.result ?? "")
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-gray-900">{exp.name}</p>
              <Badge variant="secondary" className="text-xs">{exp.channel}</Badge>
              {exp.winner === true && <Badge variant="success" className="text-xs">✓ Ganador</Badge>}
              {exp.winner === false && <Badge variant="outline" className="text-xs">✗ No ganador</Badge>}
            </div>
            <p className="text-sm text-gray-500 mb-2">{exp.hypothesis}</p>
            <p className="text-xs text-gray-400">Métrica: {exp.metric_to_improve}</p>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {exp.result ? "Editar resultado" : "Registrar resultado"}
            </Button>
          )}
        </div>

        {editing && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <Textarea
              placeholder="¿Qué resultado obtuviste?"
              value={result}
              onChange={e => setResult(e.target.value)}
              rows={2}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { onUpdateResult(exp.id, result, true); setEditing(false) }}>
                ✓ Ganador
              </Button>
              <Button size="sm" variant="outline" onClick={() => { onUpdateResult(exp.id, result, false); setEditing(false) }}>
                ✗ No ganador
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {exp.result && !editing && (
          <div className="mt-3 rounded bg-gray-50 p-3 text-sm text-gray-700 border-t">
            <span className="text-xs text-gray-400 font-medium">Resultado: </span>
            {exp.result}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
