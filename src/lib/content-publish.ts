import type { SupabaseClient } from "@supabase/supabase-js"
import { publishImageToInstagram, publishCarouselToInstagram } from "@/lib/instagram-business"
import { createGoogleBusinessPost } from "@/lib/google-business"
import type { ContentChannel, ContentItem } from "@/types"

/** Portada + todas las slides con imagen propia, en orden. Ver el chequeo de aprobacion en /api/content/items. */
function carouselImageUrls(item: ContentItem): string[] {
  return [item.visual_url, ...(item.slides ?? []).map(slide => slide.visual_url)]
    .filter((url): url is string => Boolean(url))
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
): Promise<{ item: ContentItem; allPublished: boolean }> {
  const result: NonNullable<ContentItem["auto_publish_result"]> = { ...item.auto_publish_result }
  let instagramMediaId: string | null | undefined

  if (channelsToTry.includes("instagram")) {
    try {
      if (item.format === "carrusel") {
        const published = await publishCarouselToInstagram(supabase, {
          imageUrls: carouselImageUrls(item),
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[content-publish] item=${item.id} canal=instagram: ${message}`)
      result.instagram = "error"
    }
  }

  if (channelsToTry.includes("google_business")) {
    try {
      await createGoogleBusinessPost(supabase, { summary: item.google_text })
      result.google_business = "published"
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[content-publish] item=${item.id} canal=google_business: ${message}`)
      result.google_business = "error"
    }
  }

  const allPublished = channelsToTry.length > 0 && channelsToTry.every(channel => result[channel] === "published")
  const nextItem: ContentItem = {
    ...item,
    auto_publish_result: result,
    status: allPublished ? "published" : item.status,
    updated_at: new Date().toISOString(),
    // Se guarda el mismo media_id ante una republicación evergreen (repeat_interval_days): siempre
    // corresponde al post más reciente, que es el que va a seguir acumulando insights.
    ...(instagramMediaId ? { instagram_media_id: instagramMediaId } : {}),
  }
  return { item: nextItem, allPublished }
}
