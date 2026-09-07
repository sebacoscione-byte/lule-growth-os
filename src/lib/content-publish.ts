import type { SupabaseClient } from "@supabase/supabase-js"
import { publishImageToInstagram, publishCarouselToInstagram, publishReelToInstagram } from "@/lib/instagram-business"
import { createGoogleBusinessPost } from "@/lib/google-business"
import type { ContentChannel, ContentItem } from "@/types"

/** Portada + todas las slides con imagen propia, en orden. Ver el chequeo de aprobacion en /api/content/items. */
function carouselImageUrls(item: ContentItem): string[] {
  return [item.visual_url, ...(item.slides ?? []).map(slide => slide.visual_url)]
    .filter((url): url is string => Boolean(url))
}

const MAX_PUBLISH_ERROR_LENGTH = 300

/** Conserva una causa operativa útil sin persistir credenciales que un SDK pueda incluir en el error. */
export function sanitizeContentPublishError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const sanitized = raw
    .replace(/([?&](?:access_token|api_key|key|token|client_secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/("(?:access_token|api_key|key|token|client_secret)"\s*:\s*")[^"]+("?)/gi, "$1[redacted]$2")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
  return (sanitized || "external_publish_failed").slice(0, MAX_PUBLISH_ERROR_LENGTH)
}

/**
 * Publica una pieza aprobada en los canales pedidos, canal por canal de forma independiente
 * (si uno falla, el otro igual se intenta). Usada tanto por el cron de auto-publicacion como por
 * el "Publicar ahora" manual, para no duplicar la logica de resultado parcial por canal.
 */
export async function publishApprovedItem(
  supabase: SupabaseClient,
  item: ContentItem,
  channelsToTry: ContentChannel[],
  options: { instagramImageDataUrl?: string } = {}
): Promise<{
  item: ContentItem
  allPublished: boolean
  errors: NonNullable<ContentItem["auto_publish_errors"]>
}> {
  const result: NonNullable<ContentItem["auto_publish_result"]> = { ...item.auto_publish_result }
  const errors: NonNullable<ContentItem["auto_publish_errors"]> = { ...item.auto_publish_errors }
  let instagramMediaId: string | null | undefined
  let instagramPublishedAt: string | undefined

  if (channelsToTry.includes("instagram")) {
    try {
      if (item.format === "carrusel") {
        const published = await publishCarouselToInstagram(supabase, {
          imageUrls: carouselImageUrls(item),
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
        })
        instagramMediaId = published.mediaId
      } else if (item.format === "reel") {
        if (!item.video_url) throw new Error("Subí el video antes de publicar el reel.")
        const published = await publishReelToInstagram(supabase, {
          videoUrl: item.video_url,
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
          trial: item.trial_reel,
          coverUrl: item.visual_url || undefined,
        })
        instagramMediaId = published.mediaId
      } else {
        if (!item.visual_url && !options.instagramImageDataUrl) {
          throw new Error("Generá la placa final antes de publicar en Instagram.")
        }
        const published = await publishImageToInstagram(supabase, {
          itemId: item.id,
          imageUrl: item.visual_url,
          imageDataUrl: options.instagramImageDataUrl,
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
          format: item.format,
        })
        instagramMediaId = published.mediaId
      }
      result.instagram = "published"
      delete errors.instagram
      instagramPublishedAt = new Date().toISOString()
    } catch (error) {
      const message = sanitizeContentPublishError(error)
      console.error(`[content-publish] item=${item.id} canal=instagram: ${message}`)
      result.instagram = "error"
      errors.instagram = message
    }
  }

  if (channelsToTry.includes("google_business")) {
    try {
      await createGoogleBusinessPost(supabase, { summary: item.google_text })
      result.google_business = "published"
      delete errors.google_business
    } catch (error) {
      const message = sanitizeContentPublishError(error)
      console.error(`[content-publish] item=${item.id} canal=google_business: ${message}`)
      result.google_business = "error"
      errors.google_business = message
    }
  }

  const allPublished = channelsToTry.length > 0 && channelsToTry.every(channel => result[channel] === "published")
  const updatedAt = new Date().toISOString()
  const nextItem: ContentItem = {
    ...item,
    auto_publish_result: result,
    auto_publish_errors: errors,
    status: allPublished ? "published" : item.status,
    updated_at: updatedAt,
    // Se guarda el mismo media_id ante una republicación evergreen (repeat_interval_days): siempre
    // corresponde al post más reciente, que es el que va a seguir acumulando insights.
    ...(instagramMediaId ? { instagram_media_id: instagramMediaId } : {}),
    ...(instagramPublishedAt ? { published_at: instagramPublishedAt } : {}),
  }
  return { item: nextItem, allPublished, errors }
}
