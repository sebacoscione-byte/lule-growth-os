interface PlaceReview {
  rating?: number
  text?: { text?: string }
  authorAttribution?: { displayName?: string }
  relativePublishTimeDescription?: string
  publishTime?: string
}

interface PlaceDetailsResponse {
  rating?: number
  userRatingCount?: number
  reviews?: PlaceReview[]
  googleMapsUri?: string
}

export interface GoogleReview {
  authorName: string
  rating: number
  text: string
  relativeTime: string
}

export interface GooglePlaceReviews {
  reviews: GoogleReview[]
  rating: number | null
  reviewCount: number | null
  mapsUrl: string | null
}

// Reseñas reales del perfil de Google de la doctora, tal como las devuelve Google
// (hasta 5, elegidas por su algoritmo de relevancia). No se filtran ni se ocultan
// negativas: los términos de Google Maps Platform prohíben mostrar una selección
// que dé una impresión distinta a la real.
export async function getGooglePlaceReviews(): Promise<GooglePlaceReviews | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  const placeId = process.env.GOOGLE_PLACE_ID
  if (!apiKey || !placeId) return null

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "rating,userRatingCount,reviews,googleMapsUri",
      },
      // Cachear 24h: evita pegarle a la API en cada visita y respetar cuota/costo.
      next: { revalidate: 86400 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as PlaceDetailsResponse

    return {
      reviews: (data.reviews ?? [])
        .filter(r => r.text?.text)
        .map(r => ({
          authorName: r.authorAttribution?.displayName ?? "Paciente de Google",
          rating: r.rating ?? 0,
          text: r.text!.text!,
          relativeTime: r.relativePublishTimeDescription ?? "",
        })),
      rating: data.rating ?? null,
      reviewCount: data.userRatingCount ?? null,
      mapsUrl: data.googleMapsUri ?? null,
    }
  } catch {
    return null
  }
}
