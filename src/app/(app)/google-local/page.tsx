"use client"

import Link from "next/link"
import { useEffect, useState, useCallback } from "react"
import {
  Loader2, Sparkles, Star, Trash2, Send, RefreshCw, Copy,
  CheckCircle2, ExternalLink, LogOut, MapPin, Link2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatusData {
  connected: boolean
  expired?: boolean
  needsLocationPick?: boolean
  accountId?: string
  locationId?: string
  locationName?: string
  profile?: { title?: string }
}

interface LocationOption {
  accountName: string
  accountId: string
  locationName: string
  locationId: string
  title: string
}

interface Post {
  name: string
  summary: string
  state: string
  createTime: string
}

interface Review {
  name: string
  reviewId: string
  reviewer: { displayName: string; isAnonymous: boolean; profilePhotoUrl?: string }
  starRating: string
  comment?: string
  createTime: string
  reviewReply?: { comment: string; updateTime: string }
}

const STAR_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
}

// ─── Stars component ──────────────────────────────────────────────────────────

function Stars({ rating }: { rating: string }) {
  const n = STAR_MAP[rating] ?? 0
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-4 w-4 ${i <= n ? "fill-yellow-400 text-yellow-400" : "text-gray-200"}`} />
      ))}
    </span>
  )
}

// ─── Location picker ─────────────────────────────────────────────────────────

function LocationPickerView({ onPicked }: { onPicked: () => void }) {
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [quotaError, setQuotaError] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)

  // Manual entry state
  const [locationId, setLocationId] = useState("")
  const [saving, setSaving] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/google-business/locations")
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          if (data.error.includes("429") || data.error.includes("RATE_LIMIT") || data.error.includes("Quota")) {
            setQuotaError(true)
          }
        } else {
          setLocations(data.locations ?? [])
        }
      })
      .catch(() => setQuotaError(true))
      .finally(() => setLoading(false))
  }, [])

  async function selectLocation(loc: LocationOption) {
    setSelecting(loc.locationId)
    await fetch("/api/google-business/select-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loc),
    })
    setSelecting(null)
    onPicked()
  }

  async function saveManual() {
    const lid = locationId.trim()
    if (!lid) { setManualError("Completa el Location ID"); return }
    setSaving(true)
    setManualError(null)
    const res = await fetch("/api/google-business/select-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: lid,
        locationName: `locations/${lid}`,
      }),
    })
    setSaving(false)
    if (res.ok) onPicked()
    else setManualError("Error al guardar. Verifica el Location ID.")
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 text-center">Conecta el perfil a administrar</h2>
        <p className="text-sm text-gray-500 mt-1 text-center">Usa el Location ID de la ficha de la Dra. Lucia Chahin.</p>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      ) : quotaError ? (
        <div className="w-full max-w-md space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">Google no permite listar negocios automaticamente (cuota = 0)</p>
            <p className="text-xs">Ingresa el Location ID manualmente. Sirve para administrar el perfil cuando Google no expone el Account ID.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Location ID</label>
              <Input
                value={locationId}
                onChange={e => setLocationId(e.target.value)}
                placeholder="Ej: 06098973123847387208"
              />
              <p className="text-xs text-gray-400 mt-1">
                Es el numero que aparece arriba del nombre del perfil en Google Business.
              </p>
            </div>
            {manualError && <p className="text-xs text-red-600">{manualError}</p>}
            <Button onClick={saveManual} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-md space-y-2">
          {locations.map(loc => (
            <button
              key={loc.locationId}
              onClick={() => selectLocation(loc)}
              disabled={selecting === loc.locationId}
              className="w-full flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900">{loc.title}</p>
                <p className="text-xs text-gray-400">{loc.locationId}</p>
              </div>
              {selecting === loc.locationId
                ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                : <MapPin className="h-4 w-4 text-gray-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Not connected state ──────────────────────────────────────────────────────

function getAuthErrorMessage(error: string | null) {
  if (error === "oauth_state") {
    return "Google devolvió una respuesta que no coincide con la solicitud original. Volvé a intentar la conexión desde esta pantalla."
  }
  if (error === "token_exchange") {
    return "Google autorizó la cuenta, pero no pudimos completar el intercambio de tokens. Revisá Client ID, Client Secret y el redirect URI autorizado."
  }
  if (error === "auth_denied") {
    return "La autorización fue cancelada o Google no devolvió un código válido."
  }
  return null
}

function ConnectView({ authError, expired }: { authError: string | null; expired?: boolean }) {
  const authErrorMessage = getAuthErrorMessage(authError)

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-6">
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
        <MapPin className="h-8 w-8 text-blue-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-900">
          {expired ? "Reconectá el perfil de Google" : "Conectar perfil de Google"}
        </h2>
        <p className="text-sm text-gray-500 mt-2 max-w-sm">
          {expired
            ? "La conexión anterior venció y hay que renovarla. La ficha (institución, checklist) queda guardada — no se pierde nada."
            : "Conectá la app con tu Google Business Profile para publicar posts, responder reseñas y editar el perfil sin salir de acá."}
        </p>
      </div>
      {expired && !authErrorMessage && (
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-800">
          <p className="font-medium">¿Por qué se desconecta solo?</p>
          <p className="mt-1">
            Mientras el proyecto de Google Cloud esté en modo &ldquo;Prueba&rdquo; (no verificado por Google),
            la conexión vence cada ~7 días y hay que volver a autorizarla acá. Para que deje de pasar,
            hay que publicar/verificar la app en Google Cloud Console (OAuth consent screen).
          </p>
        </div>
      )}
      {authErrorMessage && (
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-800">
          <p className="font-medium">No se pudo completar la conexión</p>
          <p className="mt-1">{authErrorMessage}</p>
        </div>
      )}
      <div className="flex flex-col items-center gap-2">
        <Button asChild size="lg" className="gap-2">
          <Link href="/api/google-business/auth" prefetch={false}>
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Conectar con Google Business
          </Link>
        </Button>
        <p className="text-xs text-gray-400">Solo necesitás hacerlo una vez</p>
      </div>
    </div>
  )
}

// ─── Checklist tab ────────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string
  item_key: string
  completed: boolean
  notes: string | null
  updated_at: string
}

const CHECKLIST_META: Record<string, { label: string; description: string; priority?: boolean }> = {
  nombre_correcto: {
    label: "Nombre correcto en Google",
    description: "Aparece como \"Dra. Lucía Chahin\" sin keywords adicionales ni nombre de institución.",
  },
  categoria_principal: {
    label: "Categoría principal configurada",
    description: "Cardióloga. Si no aparece esa opción, usar Médico.",
  },
  categoria_cardiologia: {
    label: "Categoría secundaria Cardiología",
    description: "Agregar Cardiología como categoría adicional si la plataforma lo permite.",
  },
  ubicacion_cimel: {
    label: "Ubicación en CIMEL Lanús",
    description: "Dirección: Tucumán 1314, Lanús. Verificar que el pin en el mapa sea correcto.",
  },
  horario_real: {
    label: "Horarios configurados",
    description: "Solo los días reales: martes (CIMEL Lanús). No cargar viernes si Swiss no tiene perfil propio.",
  },
  servicios_cargados: {
    label: "Servicios cargados",
    description: "Consulta cardiológica, Ecocardiograma, Control cardiológico.",
  },
  descripcion_cargada: {
    label: "Descripción del perfil",
    description: "Describir servicios, sedes y días de atención. Máx. 750 caracteres. Sin keywords artificiales.",
  },
  link_landing: {
    label: "Link → /dra-lucia-chahin",
    description: "El campo 'Sitio web' debe apuntar a la landing principal. No usar Instagram como enlace principal.",
    priority: true,
  },
  link_instagram_bio: {
    label: "Bio de Instagram apunta a /dra-lucia-chahin",
    description: "El link en la bio de Instagram debe llevar a la landing principal, no a WhatsApp ni Linktree.",
  },
  fotos_profesionales: {
    label: "Fotos subidas",
    description: "Foto de perfil profesional, foto del consultorio y/o foto exterior de CIMEL Lanús.",
  },
  telefono_configurado: {
    label: "Teléfono configurado",
    description: "Teléfono de contacto para CIMEL Lanús o número propio de la doctora.",
  },
  primera_publicacion: {
    label: "Primera publicación publicada",
    description: "Al menos un post explicando cómo pedir turno con la Dra. Lucía Chahin.",
  },
  preguntas_frecuentes: {
    label: "Preguntas frecuentes (Q&A)",
    description: "Agregar preguntas como: ¿Cómo saco turno? ¿Qué días atiende? ¿Hace ecocardiogramas?",
  },
  posts_fijados_3: {
    label: "3 publicaciones fijadas en Instagram",
    description: "Post 1: Cómo pedir turno. Post 2: Servicios. Post 3: Dónde atiende.",
  },
}

function ChecklistTab() {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    // Initial remote state hydration.
    fetch("/api/checklist")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setItems(data) })
      .finally(() => setLoading(false))
  }, [])

  async function toggle(item: ChecklistItem) {
    setToggling(item.item_key)
    const next = !item.completed
    const res = await fetch("/api/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_key: item.item_key, completed: next, notes: item.notes }),
    })
    const updated = await res.json()
    setItems(prev => prev.map(i => i.item_key === item.item_key ? { ...i, ...updated } : i))
    setToggling(null)
  }

  const completed = items.filter(i => i.completed).length
  const total = items.length

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Progreso del perfil</p>
            <span className="text-sm font-bold text-gray-900">{completed}/{total}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: total > 0 ? `${(completed / total) * 100}%` : "0%" }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Alerta de link prioritario */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <Link2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">Recomendación clave</p>
          <p>
            El campo <strong>Sitio web</strong> del perfil de Google debe apuntar a{" "}
            <code className="bg-blue-100 px-1 rounded">/dra-lucia-chahin</code>.
            Quien llega desde Google Maps tiene intención alta — hay que llevarlos directo a esa landing.
          </p>
        </div>
      </div>

      {/* Items del checklist */}
      <div className="space-y-2">
        {items.map(item => {
          const meta = CHECKLIST_META[item.item_key]
          if (!meta) return null
          return (
            <Card
              key={item.item_key}
              className={item.completed ? "opacity-70" : meta.priority ? "border-blue-300" : ""}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(item)}
                    disabled={toggling === item.item_key}
                    className="mt-0.5 shrink-0"
                  >
                    {toggling === item.item_key ? (
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    ) : item.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300 hover:border-blue-400 transition-colors" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${item.completed ? "line-through text-gray-400" : "text-gray-900"}`}>
                        {meta.label}
                      </p>
                      {meta.priority && !item.completed && (
                        <Badge className="text-xs bg-blue-100 text-blue-700 border-blue-200">Prioritario</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Profile tab ──────────────────────────────────────────────────────────────

const DAYS_ES: Record<string, string> = {
  MONDAY: "Lunes", TUESDAY: "Martes", WEDNESDAY: "Miércoles",
  THURSDAY: "Jueves", FRIDAY: "Viernes", SATURDAY: "Sábado", SUNDAY: "Domingo",
}
const ALL_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]

interface ProfileData {
  title?: string
  profile?: { description?: string }
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string }
  regularHours?: { periods?: Array<{ openDay: string; openTime: { hours?: number; minutes?: number } | string; closeTime: { hours?: number; minutes?: number } | string }> }
  phoneNumbers?: { primaryPhone?: string }
  websiteUri?: string
}

function formatTime(t: { hours?: number; minutes?: number } | string): string {
  if (typeof t === "string") return t
  const h = String(t.hours ?? 0).padStart(2, "0")
  const m = String(t.minutes ?? 0).padStart(2, "0")
  return `${h}:${m}`
}

function SaveButton({ saving, saved, disabled, onClick }: {
  saving: boolean; saved: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <div className="flex items-center gap-2 justify-end">
      {saved && (
        <span className="flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Guardado
        </span>
      )}
      <Button onClick={onClick} disabled={saving || disabled} size="sm">
        {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
        Guardar en Google
      </Button>
    </div>
  )
}

function ProfileTab({ onRefresh }: { status: StatusData; onRefresh: () => void }) {
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Description
  const [desc, setDesc] = useState("")
  const [savingDesc, setSavingDesc] = useState(false)
  const [savedDesc, setSavedDesc] = useState(false)

  // Website
  const [website, setWebsite] = useState("")
  const [savingWeb, setSavingWeb] = useState(false)
  const [savedWeb, setSavedWeb] = useState(false)

  // Phone
  const [phone, setPhone] = useState("")
  const [savingPhone, setSavingPhone] = useState(false)
  const [savedPhone, setSavedPhone] = useState(false)

  // Hours
  const [hours, setHours] = useState<Record<string, { enabled: boolean; open: string; close: string }>>({})
  const [savingHours, setSavingHours] = useState(false)
  const [savedHours, setSavedHours] = useState(false)

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingProfile(true)
    fetch("/api/google-business/profile")
      .then(r => r.json())
      .then((data: ProfileData & { error?: string }) => {
        if (data.error) { setProfileError(data.error); return }
        setProfileData(data)
        setDesc(data.profile?.description ?? "")
        setWebsite(data.websiteUri ?? "")
        setPhone(data.phoneNumbers?.primaryPhone ?? "")
        // Build hours map
        const h: Record<string, { enabled: boolean; open: string; close: string }> = {}
        ALL_DAYS.forEach(d => { h[d] = { enabled: false, open: "09:00", close: "18:00" } })
        data.regularHours?.periods?.forEach(p => {
          h[p.openDay] = { enabled: true, open: formatTime(p.openTime), close: formatTime(p.closeTime) }
        })
        setHours(h)
      })
      .catch(e => setProfileError(String(e)))
      .finally(() => setLoadingProfile(false))
  }, [])

  async function save(field: string, body: Record<string, unknown>, setSaving: (v: boolean) => void, setSaved: (v: boolean) => void) {
    setSaving(true)
    try {
      const res = await fetch("/api/google-business/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        onRefresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setProfileError(data.error ?? `Error al guardar ${field}`)
      }
    } catch {
      setProfileError(`Error de red al guardar ${field}`)
    } finally {
      setSaving(false)
    }
  }

  function saveDesc() {
    save("description", { description: desc }, setSavingDesc, setSavedDesc)
  }
  function saveWebsite() {
    save("websiteUri", { websiteUri: website }, setSavingWeb, setSavedWeb)
  }
  function savePhone() {
    save("phone", { primaryPhone: phone }, setSavingPhone, setSavedPhone)
  }
  function saveHours() {
    const periods = ALL_DAYS
      .filter(d => hours[d]?.enabled)
      .map(d => ({ openDay: d, openTime: hours[d].open, closeTime: hours[d].close }))
    save("hours", { hours: periods }, setSavingHours, setSavedHours)
  }

  if (loadingProfile) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  if (profileError) {
    const isQuota = profileError.includes("429") || profileError.includes("RATE_LIMIT") || profileError.includes("Quota")
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-medium mb-1">{isQuota ? "Perfil no disponible (cuota API = 0)" : "Error al cargar perfil"}</p>
        <p className="text-xs mb-3">
          {isQuota
            ? "Google requiere solicitar acceso a la Business Profile API. Editá el perfil directamente en:"
            : profileError}
        </p>
        {isQuota && (
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 underline">
            Ir a Google Business <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Read-only info */}
      {profileData && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium text-gray-900">{profileData.title}</p>
            {profileData.storefrontAddress && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                {[...(profileData.storefrontAddress.addressLines ?? []), profileData.storefrontAddress.locality].filter(Boolean).join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Description */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium text-gray-700">Descripción</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} placeholder="Descripción que aparece en Google..." className="resize-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{desc.length}/750</span>
            <SaveButton saving={savingDesc} saved={savedDesc} disabled={!desc.trim()} onClick={saveDesc} />
          </div>
        </CardContent>
      </Card>

      {/* Website */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium text-gray-700">Sitio web</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
          <SaveButton saving={savingWeb} saved={savedWeb} onClick={saveWebsite} />
        </CardContent>
      </Card>

      {/* Phone */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium text-gray-700">Teléfono</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+54 11 ..." />
          <SaveButton saving={savingPhone} saved={savedPhone} onClick={savePhone} />
        </CardContent>
      </Card>

      {/* Hours */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium text-gray-700">Horarios de atención</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {ALL_DAYS.map(day => (
              <div key={day} className="flex flex-col items-stretch gap-2 rounded-md border border-gray-100 p-2 sm:flex-row sm:items-center sm:border-0 sm:p-0">
                <button
                  onClick={() => setHours(h => ({ ...h, [day]: { ...h[day], enabled: !h[day]?.enabled } }))}
                  className={`w-full text-left text-sm font-medium sm:w-24 ${hours[day]?.enabled ? "text-gray-900" : "text-gray-300"}`}
                >
                  {DAYS_ES[day]}
                </button>
                {hours[day]?.enabled ? (
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input
                      type="time"
                      value={hours[day].open}
                      onChange={e => setHours(h => ({ ...h, [day]: { ...h[day], open: e.target.value } }))}
                      className="w-full text-sm sm:w-32"
                    />
                    <span className="text-gray-400 text-sm">–</span>
                    <Input
                      type="time"
                      value={hours[day].close}
                      onChange={e => setHours(h => ({ ...h, [day]: { ...h[day], close: e.target.value } }))}
                      className="w-full text-sm sm:w-32"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-gray-300">Cerrado</span>
                )}
              </div>
            ))}
          </div>
          <SaveButton saving={savingHours} saved={savedHours} onClick={saveHours} />
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Posts tab ────────────────────────────────────────────────────────────────

function PostsTab({ hasAccountId }: { hasAccountId: boolean }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [topic, setTopic] = useState("")
  const [draftText, setDraftText] = useState("")
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    if (!hasAccountId) {
      setPosts([])
      setApiError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setApiError(null)
    const res = await fetch("/api/google-business/posts")
    const data = await res.json()
    if (data.error) setApiError(data.error)
    else setPosts(data.localPosts ?? [])
    setLoading(false)
  }, [hasAccountId])

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPosts()
  }, [fetchPosts])

  async function generateDraft() {
    if (!topic.trim()) return
    setGenerating(true)
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "google_post", topic }),
    })
    const data = await res.json()
    setDraftText(data.text ?? "")
    setGenerating(false)
  }

  async function publishPost() {
    if (!draftText.trim()) return

    if (!hasAccountId) {
      setPublishError(null)
      try {
        await navigator.clipboard.writeText(draftText)
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      } catch {
        setPublishError("No se pudo copiar automaticamente. Selecciona el texto y copialo manualmente.")
      }
      return
    }

    setPublishing(true)
    setPublishError(null)
    const res = await fetch("/api/google-business/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: draftText }),
    })
    const data = await res.json()
    setPublishing(false)
    if (res.ok && !data.error) {
      setDraftText("")
      setTopic("")
      fetchPosts()
    } else {
      setPublishError(data.error ?? "Error al publicar")
    }
  }

  async function removePost(postName: string) {
    const postId = postName.split("/").pop()!
    setDeleting(postId)
    await fetch(`/api/google-business/posts/${postId}`, { method: "DELETE" })
    setDeleting(null)
    fetchPosts()
  }

  return (
    <div className="space-y-4">
      {/* New post card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-gray-700">Nueva publicación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Tema (ej: control de presión arterial, arritmias...)"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generateDraft()}
            />
            <Button variant="outline" onClick={generateDraft} disabled={!topic.trim() || generating}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generar
            </Button>
          </div>
          {draftText && (
            <>
              <Textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                rows={5}
                className="resize-none"
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">{draftText.length}/1500 caracteres</span>
                <Button onClick={publishPost} disabled={publishing || !draftText.trim()} className="gap-2">
                  {publishing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasAccountId ? (
                    <Send className="h-4 w-4" />
                  ) : copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {hasAccountId ? "Publicar en Google" : copied ? "Copiado" : "Copiar para Google"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {publishError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <span className="font-medium">Error al publicar:</span> {publishError}
        </div>
      )}

      {!hasAccountId ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          <p className="font-medium mb-1">Publicacion manual</p>
          <p className="text-xs mb-3">
            Google no expone el Account ID de esta cuenta, asi que la app prepara el texto para copiarlo y pegarlo en el panel oficial.
          </p>
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline">
            Ir a Google Business <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : apiError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Publicaciones no disponibles via API</p>
          <p className="text-xs mb-3">{apiError}</p>
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 underline">
            Ir a Google Business <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : posts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No hay publicaciones aún</p>
      ) : (
        posts.map(post => (
          <Card key={post.name}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.summary}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(post.createTime).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removePost(post.name)}
                  disabled={deleting === post.name.split("/").pop()}
                  className="text-gray-400 hover:text-red-500 shrink-0"
                >
                  {deleting === post.name.split("/").pop()
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

// ─── Reviews tab ──────────────────────────────────────────────────────────────

function ReviewsTab() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    const res = await fetch("/api/google-business/reviews")
    const data = await res.json()
    if (data.error) setApiError(data.error)
    else setReviews(data.reviews ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReviews()
  }, [fetchReviews])

  async function generateReply(review: Review) {
    setGenerating(review.reviewId)
    const res = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "review_reply",
        topic: `${review.starRating} stars. ${review.comment ?? "Sin comentario"}`,
      }),
    })
    const data = await res.json()
    setReplyDrafts(prev => ({ ...prev, [review.reviewId]: data.text ?? "" }))
    setExpanded(review.reviewId)
    setGenerating(null)
  }

  async function publishReply(reviewId: string) {
    const comment = replyDrafts[reviewId]
    if (!comment?.trim()) return
    setPublishing(reviewId)
    await fetch(`/api/google-business/reviews/${reviewId}/reply`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    })
    setPublishing(null)
    fetchReviews()
  }

  const pendingCount = reviews.filter(r => !r.reviewReply).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {reviews.length} reseña{reviews.length !== 1 ? "s" : ""}
          {pendingCount > 0 && (
            <Badge variant="destructive" className="ml-2">{pendingCount} sin responder</Badge>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={fetchReviews} className="text-gray-400 gap-1">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : apiError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Reseñas no disponibles via API</p>
          <p className="text-xs mb-3">{apiError}</p>
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 underline">
            Ir a Google Business <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No hay reseñas todavía</p>
      ) : (
        reviews.map(review => (
          <Card key={review.reviewId} className={!review.reviewReply ? "border-orange-200" : ""}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">
                      {review.reviewer.isAnonymous ? "Anónimo" : review.reviewer.displayName}
                    </span>
                    <Stars rating={review.starRating} />
                    <span className="text-xs text-gray-400">
                      {new Date(review.createTime).toLocaleDateString("es-AR")}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-gray-700 mt-2">{review.comment}</p>
                  )}
                </div>
                {!review.reviewReply ? (
                  <Badge variant="outline" className="text-orange-600 border-orange-300 shrink-0 text-xs">Sin respuesta</Badge>
                ) : (
                  <Badge variant="outline" className="text-green-600 border-green-300 shrink-0 text-xs">Respondida</Badge>
                )}
              </div>

              {/* Existing reply */}
              {review.reviewReply && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 border-l-2 border-gray-200">
                  <span className="font-medium text-gray-500 text-xs block mb-1">Tu respuesta</span>
                  {review.reviewReply.comment}
                </div>
              )}

              {/* Reply section — only for unanswered */}
              {!review.reviewReply && (
                <div className="space-y-2">
                  {expanded === review.reviewId ? (
                    <>
                      <Textarea
                        value={replyDrafts[review.reviewId] ?? ""}
                        onChange={e => setReplyDrafts(prev => ({ ...prev, [review.reviewId]: e.target.value }))}
                        rows={3}
                        placeholder="Escribí tu respuesta..."
                        className="resize-none text-sm"
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpanded(null)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => publishReply(review.reviewId)}
                          disabled={publishing === review.reviewId || !replyDrafts[review.reviewId]?.trim()}
                          className="gap-1"
                        >
                          {publishing === review.reviewId
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Send className="h-3.5 w-3.5" />}
                          Publicar respuesta
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => generateReply(review)}
                        disabled={generating === review.reviewId}
                        className="gap-1 flex-1"
                      >
                        {generating === review.reviewId
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Sparkles className="h-3.5 w-3.5" />}
                        Generar respuesta con IA
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(review.reviewId)}
                        className="gap-1"
                      >
                        Escribir manualmente
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GoogleLocalPage() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    const res = await fetch("/api/google-business/status")
    const data = await res.json()
    setStatus(data)
    setLoadingStatus(false)
  }, [])

  useEffect(() => {
    // Initial remote state hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthError(error)
  }, [])

  async function disconnect() {
    if (!confirm("¿Desconectar la app de Google Business?")) return
    setDisconnecting(true)
    await fetch("/api/google-business/disconnect", { method: "POST" })
    setDisconnecting(false)
    fetchStatus()
  }

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google Business</h1>
          <p className="text-sm text-gray-500">
            {status?.connected
              ? `Perfil conectado · ${status.profile?.title ?? "Dra. Lucía Chahin"}`
              : "Administración del perfil en Google"}
          </p>
        </div>
        {status?.connected && (
          <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
            <a
              href="https://business.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm" className="w-full gap-1 sm:w-auto">
                <ExternalLink className="h-4 w-4" /> Ver en Google
              </Button>
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={disconnecting}
              className="text-gray-400 hover:text-red-500"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>

      {!status?.connected ? (
        <ConnectView authError={authError} expired={status?.expired} />
      ) : status?.needsLocationPick ? (
        <LocationPickerView onPicked={fetchStatus} />
      ) : (
        <Tabs defaultValue="checklist">
          <TabsList>
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
            <TabsTrigger value="posts">Publicaciones</TabsTrigger>
            <TabsTrigger value="reviews">Reseñas</TabsTrigger>
            <TabsTrigger value="profile">Perfil</TabsTrigger>
          </TabsList>

          <TabsContent value="checklist" className="mt-4">
            <ChecklistTab />
          </TabsContent>

          <TabsContent value="posts" className="mt-4">
            <PostsTab hasAccountId={Boolean(status.accountId)} />
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <ReviewsTab />
          </TabsContent>

          <TabsContent value="profile" className="mt-4">
            <ProfileTab status={status} onRefresh={fetchStatus} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
