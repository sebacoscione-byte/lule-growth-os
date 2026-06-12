"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Loader2, Sparkles, Star, Trash2, Send, RefreshCw,
  CheckCircle2, ExternalLink, LogOut, MapPin
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
  const [accountId, setAccountId] = useState("")
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
    const aid = accountId.trim()
    const lid = locationId.trim()
    if (!aid || !lid) { setManualError("Completá los dos campos"); return }
    setSaving(true)
    setManualError(null)
    const res = await fetch("/api/google-business/select-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: aid,
        accountName: `accounts/${aid}`,
        locationId: lid,
        locationName: `accounts/${aid}/locations/${lid}`,
      }),
    })
    setSaving(false)
    if (res.ok) onPicked()
    else setManualError("Error al guardar. Verificá los IDs.")
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 text-center">Elegí el negocio a administrar</h2>
        <p className="text-sm text-gray-500 mt-1 text-center">Tu cuenta tiene varios negocios. Seleccioná el de la Dra. Lucía Chahin.</p>
      </div>

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      ) : quotaError ? (
        <div className="w-full max-w-md space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">Google no permite listar negocios automáticamente (cuota = 0)</p>
            <p className="text-xs">Ingresá los IDs manualmente. Los encontrás en la URL de tu perfil de Google Business.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Account ID</label>
              <Input
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                placeholder="Ej: 123456789012345678"
              />
              <p className="text-xs text-gray-400 mt-1">
                Desde business.google.com → URL al abrir tu negocio → el número largo después de <code>/accounts/</code>
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Location ID</label>
              <Input
                value={locationId}
                onChange={e => setLocationId(e.target.value)}
                placeholder="Ej: 987654321098765432"
              />
              <p className="text-xs text-gray-400 mt-1">
                El número después de <code>/locations/</code> en la misma URL
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

function ConnectView() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-6">
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
        <MapPin className="h-8 w-8 text-blue-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Conectar perfil de Google</h2>
        <p className="text-sm text-gray-500 mt-2 max-w-sm">
          Conectá la app con tu Google Business Profile para publicar posts, responder reseñas y editar el perfil sin salir de acá.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <a href="/api/google-business/auth">
          <Button size="lg" className="gap-2">
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Conectar con Google Business
          </Button>
        </a>
        <p className="text-xs text-gray-400">Solo necesitás hacerlo una vez</p>
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
              <div key={day} className="flex items-center gap-3">
                <button
                  onClick={() => setHours(h => ({ ...h, [day]: { ...h[day], enabled: !h[day]?.enabled } }))}
                  className={`w-24 text-sm text-left font-medium ${hours[day]?.enabled ? "text-gray-900" : "text-gray-300"}`}
                >
                  {DAYS_ES[day]}
                </button>
                {hours[day]?.enabled ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={hours[day].open}
                      onChange={e => setHours(h => ({ ...h, [day]: { ...h[day], open: e.target.value } }))}
                      className="w-32 text-sm"
                    />
                    <span className="text-gray-400 text-sm">–</span>
                    <Input
                      type="time"
                      value={hours[day].close}
                      onChange={e => setHours(h => ({ ...h, [day]: { ...h[day], close: e.target.value } }))}
                      className="w-32 text-sm"
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

function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [topic, setTopic] = useState("")
  const [draftText, setDraftText] = useState("")
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    setApiError(null)
    const res = await fetch("/api/google-business/posts")
    const data = await res.json()
    if (data.error) setApiError(data.error)
    else setPosts(data.localPosts ?? [])
    setLoading(false)
  }, [])

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
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publicar en Google
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

      {/* Existing posts */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : apiError ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Publicaciones no disponibles via API</p>
          <p className="text-xs mb-3">Google eliminó el acceso público a esta función. Para publicar en Google, usá el panel oficial:</p>
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
          <p className="text-xs mb-3">Google eliminó el acceso público a esta función. Para responder reseñas, usá el panel oficial:</p>
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
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Google Business</h1>
          <p className="text-sm text-gray-500">
            {status?.connected
              ? `Perfil conectado · ${status.profile?.title ?? "Dra. Lucía Chahin"}`
              : "Administración del perfil en Google"}
          </p>
        </div>
        {status?.connected && (
          <div className="flex items-center gap-3">
            <a
              href="https://business.google.com/"
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-1">
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
        <ConnectView />
      ) : status?.needsLocationPick ? (
        <LocationPickerView onPicked={fetchStatus} />
      ) : (
        <Tabs defaultValue="posts">
          <TabsList>
            <TabsTrigger value="posts">Publicaciones</TabsTrigger>
            <TabsTrigger value="reviews">Reseñas</TabsTrigger>
            <TabsTrigger value="profile">Perfil</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4">
            <PostsTab />
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
