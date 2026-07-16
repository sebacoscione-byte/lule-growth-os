"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  MapPin, Heart, Settings, Pencil, Check, X, Plus, Trash2,
  Loader2, Clock, Link2, Phone, Stethoscope, Shield, Bot, Activity, DollarSign, MessageSquareText, Copy, ClipboardCheck,
  KeyRound, UserCircle,
} from "lucide-react"
import type { WhatsAppAiProvider, WhatsAppPricingRule, WhatsAppTemplate, TemplateStatus, WhatsAppSettings } from "@/types"
import { createClient } from "@/lib/supabase/client"

type Doctor = {
  name: string
  specialty: string
  bio: string
  matricula: string
  specializations: string[]
  conditions_treated: string[]
}

type Location = {
  id: string
  name: string
  address: string
  google_maps_link: string
  phone: string
  whatsapp: string
  hours: string
  booking_url: string
  services: string[]
  obras_sociales: string[]
  booking_instruction: string
  notes: string
  day?: string
  verified_at?: string
  verified_by?: string
  valid_from?: string
  active: boolean
}

type LocationStatus = {
  id: string
  status: "operational" | "inactive" | "unverified" | "not_yet_valid"
  active: boolean
  verified: boolean
  operational: boolean
}

type AiStatus = {
  requested: "auto" | "gemini" | "anthropic"
  active: "gemini" | "anthropic" | null
}

const DEFAULT_LOCATION: Omit<Location, "id" | "name"> = {
  address: "",
  google_maps_link: "",
  phone: "",
  whatsapp: "",
  hours: "",
  booking_url: "",
  services: [],
  obras_sociales: [],
  booking_instruction: "",
  notes: "",
  active: false,
}

const DEFAULT_WA_SETTINGS: WhatsAppSettings = {
  bot_enabled: true,
  session_ttl_hours: 24,
  shadow_mode_enabled: false,
  policy_rollout_percent: 0,
  cost_saving_mode: false,
  enable_service_message_charging: false,
  warning_message_threshold: 8,
  handoff_message_threshold: 12,
  monthly_cost_alert_ars: null,
  ai_provider: "sin_ia",
}

type LegacyLocation = Partial<Location> & Pick<Location, "id" | "name"> & { practices?: string[] }

const SUPPORTED_LOCATIONS: Array<Pick<Location, "id" | "name">> = [
  { id: "cimel_lanus", name: "CIMEL Lanús" },
  { id: "hospital_britanico", name: "Hospital Británico" },
  { id: "swiss_lomas", name: "Swiss Medical Lomas" },
]

function parseAuthoritativeLocations(data: unknown): {
  locations: Location[]
  statuses: LocationStatus[]
  version: string
} | null {
  if (!data || typeof data !== "object") return null
  const payload = data as Record<string, unknown>
  const status = payload.locations_status as Record<string, unknown> | undefined
  if (!Array.isArray(payload.locations) || status?.valid !== true || !Array.isArray(status.items)) {
    return null
  }
  if (typeof payload.version !== "string" || !/^[a-f0-9]{64}$/.test(payload.version)) return null

  const supportedIds = new Set(SUPPORTED_LOCATIONS.map(location => location.id))
  const locations = payload.locations as LegacyLocation[]
  if (!locations.every(location =>
    location && typeof location === "object"
    && typeof location.id === "string" && supportedIds.has(location.id)
    && typeof location.name === "string"
  )) return null

  const statuses = status.items as LocationStatus[]
  const allowedStatuses = new Set(["operational", "inactive", "unverified", "not_yet_valid"])
  if (!statuses.every(item =>
    item && typeof item === "object"
    && typeof item.id === "string" && supportedIds.has(item.id)
    && allowedStatuses.has(item.status)
    && typeof item.active === "boolean"
    && typeof item.verified === "boolean"
    && typeof item.operational === "boolean"
  )) return null

  return {
    locations: locations.map(normalizeLocationForEditor),
    statuses,
    version: payload.version,
  }
}

function normalizeLocationForEditor(location: LegacyLocation): Location {
  const { practices, ...canonical } = location
  return {
    ...DEFAULT_LOCATION,
    ...canonical,
    id: location.id,
    name: location.name,
    services: [...(location.services ?? practices ?? [])],
    obras_sociales: [...(location.obras_sociales ?? [])],
  }
}

const AI_PROVIDER_LABELS: Record<WhatsAppAiProvider, string> = {
  sin_ia: "Sin IA (solo reglas)",
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI (no implementado)",
  otro_llm: "Otro LLM (no implementado)",
  meta_business_agent: "Meta Business Agent (no implementado)",
}

const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  borrador: "Borrador",
  pendiente_meta: "Pendiente de Meta",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
}

const TEMPLATE_STATUS_VARIANT: Record<TemplateStatus, "secondary" | "warning" | "success" | "destructive"> = {
  borrador: "secondary",
  pendiente_meta: "warning",
  aprobado: "success",
  rechazado: "destructive",
}

export default function ConfiguracionPage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationStatuses, setLocationStatuses] = useState<LocationStatus[]>([])
  const [locationsVersion, setLocationsVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [configurationLoadError, setConfigurationLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [waSettings, setWaSettings] = useState<WhatsAppSettings>(DEFAULT_WA_SETTINGS)
  const [pricingRules, setPricingRules] = useState<WhatsAppPricingRule[]>([])
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([])
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [editingDoctor, setEditingDoctor] = useState(false)
  const [doctorDraft, setDoctorDraft] = useState<Doctor | null>(null)

  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [locationDraft, setLocationDraft] = useState<Location | null>(null)
  const [newLocationId, setNewLocationId] = useState<string | null>(null)
  const [locationConfirmed, setLocationConfirmed] = useState(false)

  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null))
  }, [])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordMsg(null)

    if (newPassword.length < 6) {
      setPasswordMsg({ type: "error", text: "La contraseña debe tener al menos 6 caracteres" })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Las contraseñas no coinciden" })
      return
    }

    setChangingPassword(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)

    if (error) {
      setPasswordMsg({ type: "error", text: "No se pudo actualizar la contraseña. Probá de nuevo." })
      return
    }

    setNewPassword("")
    setConfirmPassword("")
    setPasswordMsg({ type: "success", text: "Contraseña actualizada" })
  }

  useEffect(() => {
    fetch("/api/config")
      .then(async response => {
        if (!response.ok) throw new Error("config_unavailable")
        return response.json()
      })
      .then(data => {
        const authoritative = parseAuthoritativeLocations(data)
        if (!authoritative) throw new Error("invalid_locations_config")
        setDoctor(data.doctor ?? null)
        setLocations(authoritative.locations)
        setLocationStatuses(authoritative.statuses)
        setLocationsVersion(authoritative.version)
        setWaSettings({ ...DEFAULT_WA_SETTINGS, ...(data.whatsapp_settings ?? {}) })
      })
      .catch(() => setConfigurationLoadError("No se pudo validar la configuración. Recargá la página antes de editar."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch("/api/ai/status")
      .then(r => r.json())
      .then(data => {
        if (!data.error) setAiStatus(data)
      })
  }, [])

  useEffect(() => {
    fetch("/api/whatsapp/pricing").then(r => r.json()).then(data => setPricingRules(Array.isArray(data) ? data : []))
    fetch("/api/whatsapp/templates").then(r => r.json()).then(data => setTemplates(Array.isArray(data) ? data : []))
  }, [])

  async function saveWaSettings(patch: Partial<WhatsAppSettings>) {
    const previous = waSettings
    const updated = { ...waSettings, ...patch }
    setWaSettings(updated)
    const ok = await saveConfig("whatsapp_settings", updated)
    if (!ok) setWaSettings(previous)
  }

  async function savePricingAmount(id: string, cost_amount: number | null) {
    setPricingRules(prev => prev.map(r => r.id === id ? { ...r, cost_amount } : r))
    await fetch(`/api/whatsapp/pricing/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cost_amount }),
    })
  }

  async function saveTemplateStatus(id: string, status: TemplateStatus) {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    await fetch(`/api/whatsapp/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
  }

  async function saveTemplateBody(id: string, body_text: string) {
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, body_text } : t))
    setEditingTemplateId(null)
    await fetch(`/api/whatsapp/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body_text }),
    })
  }

  async function copyToClipboard(id: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function saveConfig(key: string, value: unknown): Promise<boolean> {
    setSaving(true)
    setConfigError(null)
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setSaved(key)
      setTimeout(() => setSaved(null), 2500)
      return true
    } catch {
      setConfigError(key)
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── Doctor ──────────────────────────────────────────────
  function startEditDoctor() {
    setDoctorDraft(doctor
      ? {
          ...doctor,
          specializations: [...(doctor.specializations ?? [])],
          conditions_treated: [...(doctor.conditions_treated ?? [])],
        }
      : { name: "", specialty: "", bio: "", matricula: "", specializations: [], conditions_treated: [] }
    )
    setEditingDoctor(true)
  }

  async function saveDoctor() {
    if (!doctorDraft) return
    const ok = await saveConfig("doctor", doctorDraft)
    if (ok) {
      setDoctor(doctorDraft)
      setEditingDoctor(false)
    }
  }

  // ── Locations ───────────────────────────────────────────
  function startEditLocation(loc: Location) {
    setLocationDraft({
      ...DEFAULT_LOCATION,
      ...loc,
      services: [...(loc.services ?? [])],
      obras_sociales: [...(loc.obras_sociales ?? [])],
    })
    setEditingLocationId(loc.id)
    setNewLocationId(null)
    setLocationConfirmed(false)
  }

  function updateLocationDraft(patch: Partial<Location>) {
    setLocationDraft(current => current ? { ...current, ...patch } : current)
    setLocationConfirmed(false)
  }

  function applyAuthoritativeLocationResponse(data: unknown): boolean {
    const authoritative = parseAuthoritativeLocations(data)
    if (!authoritative) {
      setConfigurationLoadError("El servidor devolvió una configuración inválida. Recargá antes de continuar.")
      return false
    }
    setLocations(authoritative.locations)
    setLocationStatuses(authoritative.statuses)
    setLocationsVersion(authoritative.version)
    return true
  }

  async function saveLocation() {
    if (!locationDraft || !locationsVersion || !locationConfirmed) {
      setConfigError("locations")
      return
    }

    const id = locationDraft.id
    const editable = {
      name: locationDraft.name,
      address: locationDraft.address,
      google_maps_link: locationDraft.google_maps_link,
      phone: locationDraft.phone,
      whatsapp: locationDraft.whatsapp,
      hours: locationDraft.hours,
      booking_url: locationDraft.booking_url,
      day: locationDraft.day,
      booking_instruction: locationDraft.booking_instruction,
      obras_sociales: locationDraft.obras_sociales.map(value => value.trim()).filter(Boolean),
      services: locationDraft.services.map(value => value.trim()).filter(Boolean),
      notes: locationDraft.notes,
      active: locationDraft.active,
    }

    setSaving(true)
    setConfigError(null)
    try {
      const response = await fetch(`/api/config/locations/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: locationsVersion, confirmed: true, location: editable }),
      })
      if (!response.ok) {
        if (response.status === 409) {
          setConfigurationLoadError("Otra persona modificó las sedes. Recargá para trabajar sobre la versión actual.")
        }
        throw new Error("location_update_failed")
      }

      const data = await response.json()
      if (applyAuthoritativeLocationResponse(data)) {
        setSaved(`location:${id}`)
        setTimeout(() => setSaved(null), 2500)
        setNewLocationId(null)
        setLocationDraft(null)
        setEditingLocationId(null)
        setLocationConfirmed(false)
      }
    } catch {
      setConfigError("locations")
    } finally {
      setSaving(false)
    }
  }

  function cancelLocationEdit() {
    if (newLocationId) {
      setLocations(current => current.filter(location => location.id !== newLocationId))
    }
    setNewLocationId(null)
    setLocationDraft(null)
    setEditingLocationId(null)
    setLocationConfirmed(false)
    setConfigError(null)
  }

  function addLocation() {
    const supported = SUPPORTED_LOCATIONS.find(candidate => !locations.some(location => location.id === candidate.id))
    if (!supported) return
    const newLoc: Location = {
      ...supported,
      ...DEFAULT_LOCATION,
    }
    setLocations(current => [...current, newLoc])
    setLocationDraft(newLoc)
    setEditingLocationId(newLoc.id)
    setNewLocationId(newLoc.id)
    setLocationConfirmed(false)
  }

  async function deleteLocation(id: string) {
    if (!locationsVersion || !window.confirm("¿Eliminar esta sede? Las demás conservarán su verificación.")) return

    setSaving(true)
    setConfigError(null)
    try {
      const response = await fetch(`/api/config/locations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: locationsVersion }),
      })
      if (!response.ok) {
        if (response.status === 409) {
          setConfigurationLoadError("Otra persona modificó las sedes. Recargá para trabajar sobre la versión actual.")
        }
        throw new Error("location_delete_failed")
      }
      const data = await response.json()
      if (applyAuthoritativeLocationResponse(data)) {
        setSaved("locations")
        setTimeout(() => setSaved(null), 2500)
      }
    } catch {
      setConfigError("locations")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (configurationLoadError) {
    return (
      <div className="p-4 md:p-6">
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base text-red-700">Configuración bloqueada por seguridad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-700">
            <p>{configurationLoadError}</p>
            <Button onClick={() => window.location.reload()}>Recargar configuración</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-gray-700" />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Configuración</h1>
          <p className="text-sm text-gray-500">Datos usados para publicaciones e información a pacientes</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-gray-700" /> Mi cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {userEmail && <Row label="Email" value={userEmail} />}
          <form onSubmit={handleChangePassword} className="space-y-3 border-t pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Cambiar contraseña
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nueva contraseña">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </Field>
              <Field label="Confirmar contraseña">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </Field>
            </div>
            {passwordMsg && (
              <p className={`text-xs ${passwordMsg.type === "success" ? "text-green-600" : "text-red-600"}`}>
                {passwordMsg.text}
              </p>
            )}
            <Button type="submit" size="sm" disabled={changingPassword}>
              {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualizar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-500" /> Proveedor de IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Proveedor activo" value={aiStatus?.active === "gemini" ? "Google Gemini" : aiStatus?.active === "anthropic" ? "Anthropic Claude" : "Sin configurar"} />
          <Row label="Modo" value={aiStatus?.requested ?? "auto"} />
          <p className="text-xs text-gray-500">
            Configura <code>AI_PROVIDER=gemini</code> y <code>GEMINI_API_KEY</code> en Vercel o en <code>.env.local</code>.
            Con <code>AI_PROVIDER=auto</code>, Gemini tiene prioridad cuando su clave esta disponible.
          </p>
        </CardContent>
      </Card>

      {/* ── Bot de WhatsApp: costos y modo ahorro ────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-green-600" /> Bot de WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-start gap-2 cursor-pointer rounded-md border border-gray-200 p-3">
            <input type="checkbox" className="mt-1" checked={waSettings.bot_enabled}
              onChange={e => saveWaSettings({ bot_enabled: e.target.checked })} />
            <span>
              <span className="font-medium text-gray-900">Bot habilitado</span>
              <p className="text-xs text-gray-500">Kill switch global. Aunque se apague, siguen funcionando las respuestas fijas de urgencia, baja y formato no soportado.</p>
            </span>
          </label>

          <Field label="Proveedor de IA para clasificar intents (respaldo, no obligatorio)">
            <Select value={waSettings.ai_provider} onValueChange={v => saveWaSettings({ ai_provider: v as WhatsAppAiProvider })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(AI_PROVIDER_LABELS) as WhatsAppAiProvider[]).map(p => (
                  <SelectItem key={p} value={p}>{AI_PROVIDER_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400 mt-1">
              Las reglas determinísticas van primero siempre. Este proveedor solo entra si el mensaje no matchea
              ninguna regla. &ldquo;Sin IA&rdquo; es el default: cero costo extra de IA en el bot.
            </p>
          </Field>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={waSettings.cost_saving_mode}
              onChange={e => saveWaSettings({ cost_saving_mode: e.target.checked })} />
            <span>
              <span className="font-medium text-gray-900">Modo ahorro (cost_saving_mode)</span>
              <p className="text-xs text-gray-500">Respuestas más compactas, sin saludos repetidos, deriva antes a humano ante ambigüedad.</p>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={waSettings.enable_service_message_charging}
              onChange={e => saveWaSettings({ enable_service_message_charging: e.target.checked })} />
            <span>
              <span className="font-medium text-gray-900">Simular cobro de mensajes service (cambio de Meta del 1/10/2026)</span>
              <p className="text-xs text-gray-500">Fuerza el modo ahorro y trata los mensajes service/utility dentro de ventana como facturables, para probar el sistema antes de la fecha real.</p>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Aviso interno a los X mensajes">
              <Input type="number" min={1} value={waSettings.warning_message_threshold}
                onChange={e => saveWaSettings({ warning_message_threshold: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="Derivar a humano a los X mensajes">
              <Input type="number" min={1} value={waSettings.handoff_message_threshold}
                onChange={e => saveWaSettings({ handoff_message_threshold: Number(e.target.value) || 1 })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reiniciar sesion tras X horas inactiva">
              <Input type="number" min={1} max={168} value={waSettings.session_ttl_hours}
                onChange={e => saveWaSettings({ session_ttl_hours: Number(e.target.value) || 24 })} />
            </Field>
          </div>
          <Field label="Alertar si el gasto mensual proyectado supera (ARS, opcional)">
            <Input type="number" min={0} value={waSettings.monthly_cost_alert_ars ?? ""}
              onChange={e => saveWaSettings({ monthly_cost_alert_ars: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          {saved === "whatsapp_settings" && <p className="text-xs text-green-600 font-medium">Guardado</p>}
          {configError === "whatsapp_settings" && <p className="text-xs text-red-600 font-medium">No se pudo guardar. Probá de nuevo.</p>}
        </CardContent>
      </Card>

      {/* ── Precios de WhatsApp (Meta) ────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600" /> Precios de WhatsApp (Meta)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            Estructura real de precios de Meta (categoría, ventana, vigencia). Los montos exactos no vienen
            precargados porque dependen del tarifario de tu cuenta — completalos desde WhatsApp Manager → Facturación.
          </p>
          <div className="space-y-2">
            {pricingRules.map(rule => (
              <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2.5 text-xs">
                <Badge variant="secondary">{rule.category}</Badge>
                <span className="text-gray-500">{rule.is_template ? "template" : "free-form"}</span>
                <span className="text-gray-500">{rule.in_window ? "dentro de ventana" : "fuera de ventana"}</span>
                <span className="text-gray-400">{rule.entry_point}</span>
                <span className="text-gray-400">desde {rule.valid_from}{rule.valid_to ? ` hasta ${rule.valid_to}` : ""}</span>
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-gray-500">{rule.currency}</span>
                  <Input
                    type="number" step="0.01" min={0} className="w-24 h-7 text-xs"
                    defaultValue={rule.cost_amount ?? ""}
                    placeholder="pendiente"
                    onBlur={e => savePricingAmount(rule.id, e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
              </div>
            ))}
            {pricingRules.length === 0 && <p className="text-xs text-gray-400">Cargando reglas de precio…</p>}
          </div>
        </CardContent>
      </Card>

      {/* ── Templates de WhatsApp ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-indigo-600" /> Templates de WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            Copiá el nombre y el cuerpo tal cual y pegalos en WhatsApp Manager → Plantillas de mensajes → Crear
            plantilla (categoría Utilidad). Un template solo se puede usar para responder fuera de la ventana de
            24h una vez que Meta lo marca &ldquo;Aprobado&rdquo; acá.
          </p>
          <div className="space-y-2">
            {templates.map(tpl => (
              <div key={tpl.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(`${tpl.id}-name`, tpl.name)}
                    className="flex items-center gap-1.5 font-medium text-sm text-gray-900 hover:text-blue-600"
                    title="Copiar nombre del template"
                  >
                    {copiedId === `${tpl.id}-name` ? <ClipboardCheck className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-gray-400" />}
                    {tpl.name}
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{tpl.category}</Badge>
                    <Select value={tpl.status} onValueChange={v => saveTemplateStatus(tpl.id, v as TemplateStatus)}>
                      <SelectTrigger className="h-7 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TEMPLATE_STATUS_LABELS) as TemplateStatus[]).map(s => (
                          <SelectItem key={s} value={s}>{TEMPLATE_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge variant={TEMPLATE_STATUS_VARIANT[tpl.status]}>{TEMPLATE_STATUS_LABELS[tpl.status]}</Badge>
                  </div>
                </div>

                {editingTemplateId === tpl.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={templateDraft}
                      onChange={e => setTemplateDraft(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveTemplateBody(tpl.id, templateDraft)}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingTemplateId(null)}>
                        <X className="h-3.5 w-3.5 mr-1" /> Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-gray-600">{tpl.body_text}</p>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2"
                        onClick={() => copyToClipboard(tpl.id, tpl.body_text)}
                        title="Copiar cuerpo del mensaje"
                      >
                        {copiedId === tpl.id ? <ClipboardCheck className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2"
                        onClick={() => { setEditingTemplateId(tpl.id); setTemplateDraft(tpl.body_text) }}
                        title="Editar cuerpo del mensaje"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {tpl.variable_samples?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
                    <span className="text-[11px] text-gray-400 mr-1">Muestras para Meta:</span>
                    {tpl.variable_samples.map((sample, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => copyToClipboard(`${tpl.id}-sample-${i}`, sample)}
                        className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700 hover:border-blue-300 hover:text-blue-700"
                        title={`Copiar muestra de {{${i + 1}}}`}
                      >
                        {copiedId === `${tpl.id}-sample-${i}`
                          ? <ClipboardCheck className="h-3 w-3 text-green-600" />
                          : <Copy className="h-3 w-3 text-gray-400" />}
                        <span className="font-mono">{`{{${i + 1}}}`}</span> {sample}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-gray-400">Cargando templates…</p>}
          </div>
        </CardContent>
      </Card>

      {/* ── Datos de la doctora ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" /> Datos de la doctora
            </CardTitle>
            {!editingDoctor && (
              <Button variant="ghost" size="sm" onClick={startEditDoctor}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {editingDoctor && doctorDraft ? (
            <>
              <Field label="Nombre completo">
                <Input value={doctorDraft.name} onChange={e => setDoctorDraft({ ...doctorDraft, name: e.target.value })} placeholder="Dra. Lucía Chahin" />
              </Field>
              <Field label="Especialidad">
                <Input value={doctorDraft.specialty} onChange={e => setDoctorDraft({ ...doctorDraft, specialty: e.target.value })} placeholder="Cardiología" />
              </Field>
              <Field label="Matrícula">
                <Input value={doctorDraft.matricula} onChange={e => setDoctorDraft({ ...doctorDraft, matricula: e.target.value })} placeholder="MP 12345 / MN 67890" />
              </Field>
              <Field label="Bio (para publicaciones)">
                <textarea
                  value={doctorDraft.bio}
                  onChange={e => setDoctorDraft({ ...doctorDraft, bio: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Cardióloga con X años de experiencia, especializada en..."
                />
              </Field>
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Stethoscope className="h-3 w-3" /> Especialista en
                </p>
                <StringList
                  items={doctorDraft.specializations ?? []}
                  onChange={specializations => setDoctorDraft({ ...doctorDraft, specializations })}
                  placeholder="Ej: Ecocardiografía"
                  addLabel="Agregar especialización"
                />
              </div>
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Enfermedades tratadas
                </p>
                <StringList
                  items={doctorDraft.conditions_treated ?? []}
                  onChange={conditions_treated => setDoctorDraft({ ...doctorDraft, conditions_treated })}
                  placeholder="Ej: Arritmias"
                  addLabel="Agregar enfermedad tratada"
                />
              </div>
              <SaveCancel
                saving={saving}
                onSave={saveDoctor}
                onCancel={() => setEditingDoctor(false)}
                error={configError === "doctor" ? "No se pudo guardar. Probá de nuevo." : null}
              />
            </>
          ) : doctor ? (
            <div className="space-y-2">
              <Row label="Nombre" value={doctor.name} />
              <Row label="Especialidad" value={doctor.specialty} />
              {doctor.matricula && <Row label="Matrícula" value={doctor.matricula} />}
              {doctor.bio && (
                <div className="text-sm">
                  <span className="text-gray-500">Bio: </span>
                  <span className="text-gray-900">{doctor.bio}</span>
                </div>
              )}
              {doctor.specializations?.length > 0 && (
                <div className="flex items-start gap-2">
                  <Stethoscope className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-gray-500 mb-1">Especialista en</p>
                    <div className="flex flex-wrap gap-1">
                      {doctor.specializations.map(s => (
                        <span key={s} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {doctor.conditions_treated?.length > 0 && (
                <div className="flex items-start gap-2">
                  <Activity className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-gray-500 mb-1">Enfermedades tratadas</p>
                    <div className="flex flex-wrap gap-1">
                      {doctor.conditions_treated.map(c => (
                        <span key={c} className="bg-rose-50 text-rose-700 text-xs px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {saved === "doctor" && <p className="text-xs text-green-600 font-medium">Guardado</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin datos. Tocá el lápiz para cargar.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Instituciones ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" /> Lugares de atención
          </h2>
          <Button variant="outline" size="sm" onClick={addLocation}
            disabled={saving || SUPPORTED_LOCATIONS.every(candidate => locations.some(location => location.id === candidate.id))}
            className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1" /> Agregar lugar
          </Button>
        </div>

        {locations.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">
            No hay lugares cargados todavía. Usá el botón para agregar.
          </p>
        )}

        {locations.map((loc) => (
          <Card key={loc.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{loc.name}</CardTitle>
                  <LocationVerificationBadge status={locationStatuses.find(item => item.id === loc.id)} />
                </div>
                {editingLocationId !== loc.id && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEditLocation(loc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteLocation(loc.id)}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editingLocationId === loc.id && locationDraft ? (
                <div className="space-y-4">
                  {/* Datos básicos */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Datos básicos</p>
                    <Field label="Nombre institución">
                      <Input value={locationDraft.name} onChange={e => updateLocationDraft({ name: e.target.value })} />
                    </Field>
                    <label className="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm">
                      <input type="checkbox" className="mt-1" checked={locationDraft.active}
                        onChange={e => updateLocationDraft({ active: e.target.checked })} />
                      <span>
                        <span className="font-medium text-gray-900">Sede activa</span>
                        <p className="text-xs text-gray-500">Define si esta sede puede informarse por WhatsApp. No modifica ni verifica ninguna otra sede.</p>
                      </span>
                    </label>
                    <Field label="Dirección">
                      <Input value={locationDraft.address} onChange={e => updateLocationDraft({ address: e.target.value })} placeholder="Tucumán 1314, Lanús" />
                    </Field>
                    <Field label="Link Google Maps">
                      <Input value={locationDraft.google_maps_link} onChange={e => updateLocationDraft({ google_maps_link: e.target.value })} placeholder="https://maps.google.com/..." />
                    </Field>
                    <Field label="Teléfono para turnos">
                      <Input value={locationDraft.phone} onChange={e => updateLocationDraft({ phone: e.target.value })} placeholder="011 4xxx-xxxx" />
                    </Field>
                    <Field label="WhatsApp propio de la institución (opcional)">
                      <Input value={locationDraft.whatsapp} onChange={e => updateLocationDraft({ whatsapp: e.target.value })} placeholder="Ej: 11 5051-9982" />
                      <p className="text-xs text-gray-400 mt-1">
                        Solo si la institución tiene su propio WhatsApp para turnos (ej: Swity de Swiss Medical).
                        Si lo dejás vacío, el botón &ldquo;Consultar por WhatsApp&rdquo; de la landing usa el WhatsApp del consultorio.
                      </p>
                    </Field>
                    <Field label="Días y horarios">
                      <textarea
                        value={locationDraft.hours}
                        onChange={e => updateLocationDraft({ hours: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Martes 9:00 a 13:00hs&#10;Jueves 14:00 a 18:00hs"
                      />
                    </Field>
                    <Field label="Link para pedir turno (app o web)">
                      <Input value={locationDraft.booking_url} onChange={e => updateLocationDraft({ booking_url: e.target.value })} placeholder="https://www.swissmedical.com.ar/... o link de la app" />
                    </Field>
                  </div>

                  {/* Prácticas */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <Stethoscope className="h-3 w-3" /> Prácticas que se realizan
                    </p>
                    <StringList
                      items={locationDraft.services}
                      onChange={services => updateLocationDraft({ services })}
                      placeholder="Ej: Ecocardiograma"
                      addLabel="Agregar práctica"
                    />
                  </div>

                  {/* Obras sociales */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <Shield className="h-3 w-3" /> Obras sociales / prepagas que atiende
                    </p>
                    <StringList
                      items={locationDraft.obras_sociales}
                      onChange={obras_sociales => updateLocationDraft({ obras_sociales })}
                      placeholder="Ej: OSDE, Swiss Medical, PAMI..."
                      addLabel="Agregar cobertura"
                    />
                  </div>

                  {/* Instrucción y notas */}
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Texto para pacientes</p>
                    <Field label="Instrucción para pedir turno">
                      <textarea
                        value={locationDraft.booking_instruction}
                        onChange={e => updateLocationDraft({ booking_instruction: e.target.value })}
                        rows={3}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Para sacar turno en CIMEL Lanús llamá al..."
                      />
                    </Field>
                    <Field label="Notas adicionales (opcional)">
                      <textarea
                        value={locationDraft.notes}
                        onChange={e => updateLocationDraft({ notes: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Info extra: estacionamiento, accesibilidad, etc."
                      />
                    </Field>
                  </div>

                  <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={locationConfirmed}
                      onChange={event => setLocationConfirmed(event.target.checked)}
                    />
                    <span>
                      <span className="font-medium text-amber-950">Confirmación exclusiva de esta sede</span>
                      <p className="text-xs text-amber-800">
                        Confirmo que revisé los datos de {locationDraft.name || "esta sede"}. El servidor registrará esta verificación sin renovar la de las demás.
                      </p>
                    </span>
                  </label>

                  <SaveCancel
                    saving={saving}
                    onSave={saveLocation}
                    onCancel={cancelLocationEdit}
                    canSave={locationConfirmed}
                    error={configError === "locations" ? "Revisá los datos y confirmá exclusivamente esta sede antes de guardar." : null}
                  />
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {loc.verified_at ? (
                    <p className="text-xs text-gray-500">Verificación registrada el {formatVerificationDate(loc.verified_at)}.</p>
                  ) : (
                    <p className="text-xs font-medium text-amber-700">Esta sede todavía no tiene verificación registrada.</p>
                  )}
                  {!locationStatuses.find(item => item.id === loc.id)?.operational && (
                    <p className="text-xs font-medium text-amber-700">No se informa por WhatsApp hasta quedar activa y verificada.</p>
                  )}
                  {loc.address && (
                    <InfoRow icon={<MapPin className="h-3.5 w-3.5 text-gray-400" />} label="Dirección" value={loc.address} />
                  )}
                  {loc.hours && (
                    <InfoRow icon={<Clock className="h-3.5 w-3.5 text-gray-400" />} label="Horarios" value={loc.hours} pre />
                  )}
                  {loc.phone && (
                    <InfoRow icon={<Phone className="h-3.5 w-3.5 text-gray-400" />} label="Teléfono" value={loc.phone} />
                  )}
                  {loc.whatsapp && (
                    <InfoRow icon={<Phone className="h-3.5 w-3.5 text-green-500" />} label="WhatsApp propio" value={loc.whatsapp} />
                  )}
                  {loc.google_maps_link && (
                    <div className="flex items-start gap-2">
                      <Link2 className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500">Google Maps</p>
                        <a href={loc.google_maps_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                          Ver en mapa
                        </a>
                      </div>
                    </div>
                  )}
                  {loc.booking_url && (
                    <div className="flex items-start gap-2">
                      <Link2 className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500">Link para pedir turno</p>
                        <a href={loc.booking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                          {loc.booking_url}
                        </a>
                      </div>
                    </div>
                  )}
                  {loc.services?.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Stethoscope className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500 mb-1">Prácticas</p>
                        <div className="flex flex-wrap gap-1">
                          {loc.services.map(p => (
                            <span key={p} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">{p}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {loc.obras_sociales?.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Shield className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-gray-500 mb-1">Obras sociales / prepagas</p>
                        <div className="flex flex-wrap gap-1">
                          {loc.obras_sociales.map(o => (
                            <span key={o} className="bg-green-50 text-green-700 text-xs px-2 py-0.5 rounded-full">{o}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {loc.booking_instruction && (
                    <div className="bg-gray-50 rounded-md p-3 text-gray-800 text-xs">
                      {loc.booking_instruction}
                    </div>
                  )}
                  {loc.notes && (
                    <p className="text-gray-500 text-xs italic">{loc.notes}</p>
                  )}
                  {(saved === "locations" || saved === `location:${loc.id}`) && <p className="text-xs text-green-600 font-medium">Guardado</p>}
                  {configError === "locations" && <p className="text-xs text-red-600 font-medium">No se pudo guardar. Probá de nuevo.</p>}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Componentes auxiliares ────────────────────────────────

function formatVerificationDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "fecha inválida"
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date)
}

function LocationVerificationBadge({ status }: { status?: LocationStatus }) {
  if (!status) return <Badge variant="warning">Nueva · sin verificar</Badge>
  if (status.status === "operational") return <Badge variant="success">Activa y verificada</Badge>
  if (status.status === "inactive") return <Badge variant="secondary">Verificada · inactiva</Badge>
  if (status.status === "not_yet_valid") return <Badge variant="warning">Vigencia pendiente</Badge>
  return <Badge variant="warning">Sin verificar</Badge>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm sm:flex-row sm:justify-between sm:gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="break-words font-medium text-gray-900 sm:text-right">{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500 font-medium">{label}</label>
      {children}
    </div>
  )
}

function InfoRow({ icon, label, value, pre }: { icon: React.ReactNode; label: string; value: string; pre?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-gray-500">{label}</p>
        <p className={`text-gray-900 ${pre ? "whitespace-pre-line" : ""}`}>{value}</p>
      </div>
    </div>
  )
}

function StringList({
  items, onChange, placeholder, addLabel,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder: string
  addLabel: string
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={e => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
          />
          <Button variant="ghost" size="sm" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus className="h-4 w-4 mr-1" /> {addLabel}
      </Button>
    </div>
  )
}

function SaveCancel({
  saving,
  onSave,
  onCancel,
  error,
  canSave = true,
}: {
  saving: boolean
  onSave: () => void
  onCancel: () => void
  error?: string | null
  canSave?: boolean
}) {
  return (
    <div className="space-y-2 pt-2">
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="grid gap-2 sm:flex">
        <Button size="sm" onClick={onSave} disabled={saving || !canSave} className="w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
          Guardar
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="w-full sm:w-auto">
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
      </div>
    </div>
  )
}
