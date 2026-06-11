"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Sparkles } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ClassifyResult, OriginChannel } from "@/types"

export default function NuevoLeadPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [classified, setClassified] = useState<ClassifyResult | null>(null)

  const [form, setForm] = useState({
    name: "",
    phone: "",
    instagram_username: "",
    origin_channel: "manual" as OriginChannel,
    origin_campaign: "",
    searched_keyword: "",
    insurance: "",
    general_reason: "",
    consent_to_contact: true,
  })

  function update(field: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function classify() {
    if (!form.general_reason) return
    setClassifying(true)
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: form.general_reason }),
    })
    const data = await res.json()
    setClassified(data)
    setClassifying(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const payload: Record<string, unknown> = {
      ...form,
      requested_service: classified?.requested_service ?? "no_definido",
      preferred_location: classified?.suggested_location === "preguntar" ? "sin_definir" : (classified?.suggested_location ?? "sin_definir"),
      preferred_day: classified?.suggested_day === "preguntar" ? "sin_definir" : (classified?.suggested_day ?? "sin_definir"),
      priority_score: classified?.priority_score ?? 1,
      requires_human: classified?.requires_human ?? false,
      possible_emergency: classified?.possible_emergency ?? false,
      ai_summary: classified ? `Intent: ${classified.intent}. Next: ${classified.next_action}` : null,
      last_message: form.general_reason || null,
    }

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const lead = await res.json()

    if (classified?.reply_suggestion && form.general_reason) {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, content: form.general_reason, generate_reply: false }),
      })
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, content: classified.reply_suggestion, generate_reply: false }),
      })
    }

    router.push(`/leads/${lead.id}`)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/leads">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Nuevo lead</h1>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Datos de contacto</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input placeholder="Nombre completo" value={form.name} onChange={e => update("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input placeholder="+54 11..." value={form.phone} onChange={e => update("phone", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instagram</Label>
              <Input placeholder="@usuario" value={form.instagram_username} onChange={e => update("instagram_username", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cobertura médica</Label>
              <Input placeholder="OSDE, Swiss Medical, etc." value={form.insurance} onChange={e => update("insurance", e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Origen</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Canal de origen</Label>
              <Select value={form.origin_channel} onValueChange={v => update("origin_channel", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="google_maps">Google Maps</SelectItem>
                  <SelectItem value="google_search">Google Search</SelectItem>
                  <SelectItem value="landing_page">Landing Page</SelectItem>
                  <SelectItem value="referral">Referido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Campaña</Label>
                <Input placeholder="Nombre de campaña" value={form.origin_campaign} onChange={e => update("origin_campaign", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Keyword buscada</Label>
                <Input placeholder="cardióloga Lanús" value={form.searched_keyword} onChange={e => update("searched_keyword", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Mensaje del paciente</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={classify}
              disabled={!form.general_reason || classifying}
            >
              {classifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Clasificar con IA
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Escribí o pegá el mensaje del paciente..."
              value={form.general_reason}
              onChange={e => update("general_reason", e.target.value)}
              rows={4}
            />

            {classified && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 space-y-2 text-sm">
                <p className="font-medium text-blue-900">Resultado de clasificación</p>
                <div className="grid grid-cols-2 gap-2 text-blue-800">
                  <span>Intent: <strong>{classified.intent}</strong></span>
                  <span>Servicio: <strong>{classified.requested_service}</strong></span>
                  <span>Ubicación: <strong>{classified.suggested_location}</strong></span>
                  <span>Prioridad: <strong>{classified.priority_score}</strong></span>
                </div>
                {classified.possible_emergency && (
                  <p className="text-red-700 font-medium">⚠️ Posible emergencia detectada</p>
                )}
                {classified.reply_suggestion && (
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    <p className="text-xs text-blue-600 mb-1">Respuesta sugerida:</p>
                    <p className="text-blue-900 bg-white rounded p-2 whitespace-pre-wrap">{classified.reply_suggestion}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar lead"}
          </Button>
          <Link href="/leads">
            <Button type="button" variant="outline">Cancelar</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
