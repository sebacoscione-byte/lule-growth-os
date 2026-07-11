import type { AutoPublishTrackSettings } from "@/types"
import type { GooglePlaceReviews } from "@/lib/google-places"

export type RecommendationChannel = "web" | "whatsapp" | "instagram" | "google"
export type RecommendationSeverity = "info" | "warning" | "critical"

export interface GrowthRecommendation {
  id: string
  channel: RecommendationChannel
  severity: RecommendationSeverity
  message: string
  href?: string
}

// Umbrales del motor de reglas — deliberadamente simples (sin ML): sobre datos que la app ya
// junta hoy (dashboard, /costos, Estudio de contenido, reseñas de Google). Ver CLAUDE.md →
// "Sistema de recomendaciones de crecimiento".
const LOW_INTERACTION_MIN_VISITS = 20
const LOW_INTERACTION_RATE_THRESHOLD = 15
const AB_TEST_MIN_VISITS_PER_VARIANT = 150
const AB_TEST_MIN_RATE_GAP = 8
const STALE_INSTAGRAM_DAYS = 21
const LOW_GOOGLE_RATING = 4.2
const MIN_REVIEWS_FOR_RATING_CHECK = 3
const FEW_GOOGLE_REVIEWS_THRESHOLD = 5

// ─── Web / landings ─────────────────────────────────────────────────────────

export interface LandingRankingRowInput {
  slug: string
  label: string
  visits: number
  rate: number
}

export function checkLowInteractionLanding(row: LandingRankingRowInput): GrowthRecommendation | null {
  if (row.visits >= LOW_INTERACTION_MIN_VISITS && row.rate < LOW_INTERACTION_RATE_THRESHOLD) {
    return {
      id: `web-low-rate-${row.slug}`,
      channel: "web",
      severity: "warning",
      message: `"${row.label}" tuvo ${row.visits} visitas pero solo ${row.rate}% de interacción en los últimos 90 días — revisá el copy o el orden de los botones.`,
      href: `/${row.slug}`,
    }
  }
  return null
}

export function checkZeroVisitLanding(row: LandingRankingRowInput): GrowthRecommendation | null {
  if (row.visits === 0) {
    return {
      id: `web-zero-visits-${row.slug}`,
      channel: "web",
      severity: "info",
      message: `"${row.label}" no tuvo ninguna visita en los últimos 90 días — revisá que esté bien linkeada e indexada.`,
      href: `/${row.slug}`,
    }
  }
  return null
}

export function checkMissingObrasSociales(locationName: string, obrasSociales: string[] | undefined): GrowthRecommendation | null {
  if (!obrasSociales || obrasSociales.length === 0) {
    return {
      id: `web-obras-sociales-${locationName}`,
      channel: "web",
      severity: "info",
      message: `${locationName} no tiene obras sociales cargadas en Configuración — la landing muestra el mensaje genérico de "consultá directamente" en vez de la lista real.`,
      href: "/configuracion",
    }
  }
  return null
}

export interface HeroVariantRowInput {
  variant: "a" | "b"
  visits: number
  interactionRate: number
}

export function checkHeroAbTestSignal(rows: HeroVariantRowInput[]): GrowthRecommendation | null {
  const a = rows.find(r => r.variant === "a")
  const b = rows.find(r => r.variant === "b")
  if (!a || !b) return null
  if (a.visits < AB_TEST_MIN_VISITS_PER_VARIANT || b.visits < AB_TEST_MIN_VISITS_PER_VARIANT) return null

  const gap = Math.abs(a.interactionRate - b.interactionRate)
  if (gap < AB_TEST_MIN_RATE_GAP) return null

  const winner = a.interactionRate > b.interactionRate ? "A (Pedir turno primero)" : "B (Ver sedes primero)"
  return {
    id: "web-ab-test-signal",
    channel: "web",
    severity: "info",
    message: `El test A/B del hero ya tiene suficientes visitas por variante y una diferencia de ${gap} puntos de interacción — la variante ${winner} viene ganando, podrías cortar el test y quedarte con esa.`,
    href: "/dashboard",
  }
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

export function checkWhatsAppBudget(projectedMonthlyCost: number, monthlyCostAlertArs: number | null): GrowthRecommendation | null {
  if (monthlyCostAlertArs !== null && projectedMonthlyCost > monthlyCostAlertArs) {
    return {
      id: "whatsapp-over-budget",
      channel: "whatsapp",
      severity: "warning",
      message: `El costo proyectado de WhatsApp este mes (${Math.round(projectedMonthlyCost)}) supera el presupuesto configurado (${monthlyCostAlertArs}) — considerá activar el modo ahorro.`,
      href: "/costos",
    }
  }
  return null
}

export function checkUnapprovedTemplates(count: number): GrowthRecommendation | null {
  if (count > 0) {
    return {
      id: "whatsapp-unapproved-templates",
      channel: "whatsapp",
      severity: "warning",
      message: `Tenés ${count} template${count === 1 ? "" : "s"} de WhatsApp sin aprobar en Meta — sin eso, el bot no puede escribirle a un paciente fuera de la ventana de 24hs.`,
      href: "/configuracion",
    }
  }
  return null
}

/** No expone el valor del secreto, solo si está cargado — ver WA-01 en docs/BACKLOG.md. */
export function checkWhatsAppWebhookSignatureMissing(configured: boolean): GrowthRecommendation | null {
  if (!configured) {
    return {
      id: "whatsapp-webhook-signature-missing",
      channel: "whatsapp",
      severity: "critical",
      message: "Falta configurar WHATSAPP_APP_SECRET en Vercel — el webhook de WhatsApp rechaza todos los mensajes entrantes (fail-closed) hasta que se cargue esa variable.",
      href: "/configuracion",
    }
  }
  return null
}

export function checkAbandonedConversations(count: number): GrowthRecommendation | null {
  if (count > 0) {
    return {
      id: "whatsapp-abandoned-conversations",
      channel: "whatsapp",
      severity: "info",
      message: `Hay ${count} conversación${count === 1 ? "" : "es"} de WhatsApp abandonada${count === 1 ? "" : "s"} (más de 2hs sin derivar) — revisá el Inbox.`,
      href: "/inbox",
    }
  }
  return null
}

// ─── Instagram ───────────────────────────────────────────────────────────────

export function checkInstagramNotConnected(connected: boolean): GrowthRecommendation | null {
  if (!connected) {
    return {
      id: "instagram-not-connected",
      channel: "instagram",
      severity: "warning",
      message: "Instagram no está conectado — la publicación automática de contenido no puede correr hasta reconectarlo.",
      href: "/contenido/instagram",
    }
  }
  return null
}

export function checkAutoPublishAllDisabled(post: AutoPublishTrackSettings, historia: AutoPublishTrackSettings): GrowthRecommendation | null {
  if (!post.enabled && !historia.enabled) {
    return {
      id: "instagram-auto-publish-disabled",
      channel: "instagram",
      severity: "info",
      message: "La publicación automática de Instagram (posts e historias) está apagada — las piezas aprobadas solo salen si alguien las publica a mano.",
      href: "/contenido/instagram",
    }
  }
  return null
}

export function checkAutoPublishError(track: AutoPublishTrackSettings, label: string): GrowthRecommendation | null {
  if (track.enabled && track.last_run_result?.startsWith("error")) {
    return {
      id: `instagram-error-${label}`,
      channel: "instagram",
      severity: "warning",
      message: `La última corrida de publicación automática de ${label} falló: ${track.last_run_result}.`,
      href: "/contenido/instagram",
    }
  }
  return null
}

export function checkStaleInstagramPublishing(track: AutoPublishTrackSettings, label: string, now: Date): GrowthRecommendation | null {
  if (!track.enabled) return null
  const reference = track.last_published_at ?? track.last_run_at
  if (!reference) return null
  const daysSince = (now.getTime() - new Date(reference).getTime()) / (24 * 60 * 60 * 1000)
  if (daysSince > STALE_INSTAGRAM_DAYS) {
    return {
      id: `instagram-stale-${label}`,
      channel: "instagram",
      severity: "warning",
      message: `${label} está activado pero no se publicó nada hace ${Math.round(daysSince)} días — puede estar trabado (¿quedan piezas aprobadas en la cola?).`,
      href: "/contenido/instagram",
    }
  }
  return null
}

// ─── Google Maps ──────────────────────────────────────────────────────────────

export function checkGooglePlacesUnavailable(reviews: GooglePlaceReviews | null): GrowthRecommendation | null {
  if (reviews === null) {
    return {
      id: "google-places-unavailable",
      channel: "google",
      severity: "info",
      message: "No se pudieron traer reseñas de Google Maps para la landing — revisá que GOOGLE_PLACES_API_KEY y GOOGLE_PLACE_ID estén configurados.",
    }
  }
  return null
}

export function checkFewGoogleReviews(reviews: GooglePlaceReviews): GrowthRecommendation | null {
  if (reviews.reviewCount !== null && reviews.reviewCount < FEW_GOOGLE_REVIEWS_THRESHOLD) {
    return {
      id: "google-few-reviews",
      channel: "google",
      severity: "info",
      message: `Solo ${reviews.reviewCount} reseña${reviews.reviewCount === 1 ? "" : "s"} en Google Maps — considerá invitar a pacientes conformes a dejar una.`,
      href: reviews.mapsUrl ?? undefined,
    }
  }
  return null
}

export function checkLowGoogleRating(reviews: GooglePlaceReviews): GrowthRecommendation | null {
  if (
    reviews.rating !== null &&
    reviews.reviewCount !== null &&
    reviews.reviewCount >= MIN_REVIEWS_FOR_RATING_CHECK &&
    reviews.rating < LOW_GOOGLE_RATING
  ) {
    return {
      id: "google-low-rating",
      channel: "google",
      severity: "warning",
      message: `El rating de Google Maps es ${reviews.rating.toFixed(1)} sobre ${reviews.reviewCount} reseñas — revisá las últimas para ver si hay algo puntual para responder o corregir.`,
      href: reviews.mapsUrl ?? undefined,
    }
  }
  return null
}

export function checkGoogleBusinessNotConnected(connected: boolean): GrowthRecommendation | null {
  if (!connected) {
    return {
      id: "google-business-not-connected",
      channel: "google",
      severity: "info",
      message: "Google Business Profile no está conectado — no se puede editar el perfil ni responder reseñas desde la app (igual podés hacerlo desde el panel de Google directamente).",
      href: "/google-local",
    }
  }
  return null
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface GrowthRecommendationsInput {
  now: Date
  landingRanking: LandingRankingRowInput[]
  heroVariantResults: HeroVariantRowInput[]
  locations: { name: string; obrasSociales: string[] }[]
  whatsapp: {
    webhookSignatureConfigured: boolean
    projectedMonthlyCost: number
    monthlyCostAlertArs: number | null
    unapprovedTemplatesCount: number
    abandonedConversations: number
  }
  instagram: {
    connected: boolean
    post: AutoPublishTrackSettings
    historia: AutoPublishTrackSettings
  }
  google: {
    businessConnected: boolean
    placesReviews: GooglePlaceReviews | null
  }
}

export function buildGrowthRecommendations(input: GrowthRecommendationsInput): GrowthRecommendation[] {
  const recs: (GrowthRecommendation | null)[] = []

  for (const row of input.landingRanking) {
    recs.push(checkLowInteractionLanding(row))
    recs.push(checkZeroVisitLanding(row))
  }
  for (const loc of input.locations) {
    recs.push(checkMissingObrasSociales(loc.name, loc.obrasSociales))
  }
  recs.push(checkHeroAbTestSignal(input.heroVariantResults))

  recs.push(checkWhatsAppWebhookSignatureMissing(input.whatsapp.webhookSignatureConfigured))
  recs.push(checkWhatsAppBudget(input.whatsapp.projectedMonthlyCost, input.whatsapp.monthlyCostAlertArs))
  recs.push(checkUnapprovedTemplates(input.whatsapp.unapprovedTemplatesCount))
  recs.push(checkAbandonedConversations(input.whatsapp.abandonedConversations))

  recs.push(checkInstagramNotConnected(input.instagram.connected))
  recs.push(checkAutoPublishAllDisabled(input.instagram.post, input.instagram.historia))
  recs.push(checkAutoPublishError(input.instagram.post, "Posts"))
  recs.push(checkAutoPublishError(input.instagram.historia, "Historias"))
  recs.push(checkStaleInstagramPublishing(input.instagram.post, "Posts", input.now))
  recs.push(checkStaleInstagramPublishing(input.instagram.historia, "Historias", input.now))

  recs.push(checkGoogleBusinessNotConnected(input.google.businessConnected))
  if (input.google.placesReviews === null) {
    recs.push(checkGooglePlacesUnavailable(input.google.placesReviews))
  } else {
    recs.push(checkFewGoogleReviews(input.google.placesReviews))
    recs.push(checkLowGoogleRating(input.google.placesReviews))
  }

  const severityOrder: Record<RecommendationSeverity, number> = { critical: 0, warning: 1, info: 2 }
  return recs
    .filter((r): r is GrowthRecommendation => r !== null)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}
