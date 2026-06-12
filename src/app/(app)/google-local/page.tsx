"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Loader2, Sparkles, Star, Trash2, Send, RefreshCw,
  CheckCircle2, AlertCircle, ExternalLink, LogOut, ChevronDown, ChevronUp,
  MapPin, Clock, Globe
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
  accountId?: string
  locationId?: string
  locationName?: string
  profile?: {
    title?: string
    profile?: { description?: string }
    storefrontAddress?: { addressLines?: string[]; locality?: string }
    regularHours?: { periods?: Array<{ openDay: string; openTime: string; closeTime: string }> }
    websiteUri?: string
  }
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

function ProfileTab({ status, onRefresh }: { status: StatusData; onRefresh: () => void }) {
  const profile = status.profile
  const [desc, setDesc] = useState(profile?.profile?.description ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDesc(profile?.profile?.description ?? "")
  }, [profile?.profile?.description])

  async function saveDescription() {
    setSaving(true)
    const res = await fetch("/api/google-business/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: desc }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onRefresh()
    }
  }

  return (
    <div className="space-y-4">
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-gray-700">Estado del perfil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-gray-600">
                {profile.storefrontAddress?.addressLines?.join(", ")}, {profile.storefrontAddress?.locality}
              </span>
            </div>
            {profile.websiteUri && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                <a href={profile.websiteUri} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">
                  {profile.websiteUri}
                </a>
              </div>
            )}
            {profile.regularHours?.periods && (
              <div className="flex items-start gap-2 text-sm">
                <Clock className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {profile.regularHours.periods.map((p, i) => (
                    <p key={i} className="text-gray-600 capitalize">
                      {p.openDay.toLowerCase()}: {p.openTime} – {p.closeTime}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-gray-700">Descripción del perfil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={6}
            placeholder="Descripción que aparece en Google..."
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{desc.length}/750 caracteres</span>
            <div className="flex items-center gap-2">
              {saved && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Guardado en Google
                </span>
              )}
              <Button onClick={saveDescription} disabled={saving || !desc.trim()} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Guardar en Google
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Posts tab ────────────────────────────────────────────────────────────────

function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [topic, setTopic] = useState("")
  const [draftText, setDraftText] = useState("")
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/google-business/posts")
    const data = await res.json()
    setPosts(data.localPosts ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchPosts() }, [fetchPosts])

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
    const res = await fetch("/api/google-business/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: draftText }),
    })
    setPublishing(false)
    if (res.ok) {
      setDraftText("")
      setTopic("")
      fetchPosts()
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

      {/* Existing posts */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
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
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/google-business/reviews")
    const data = await res.json()
    setReviews(data.reviews ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchReviews() }, [fetchReviews])

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

  useEffect(() => { fetchStatus() }, [fetchStatus])

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
              href={`https://business.google.com/dashboard/l/${status.locationId}`}
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
