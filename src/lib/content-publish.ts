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

  if (channelsToTry.includes("instagram")) {
    try {
      if (item.format === "carrusel") {
        await publishCarouselToInstagram(supabase, {
          imageUrls: carouselImageUrls(item),
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
        })
      } else {
        if (!item.visual_url && !options.instagramImageDataUrl) {
          throw new Error("Generá la placa final antes de publicar en Instagram.")
        }
        await publishImageToInstagram(supabase, {
          itemId: item.id,
          imageUrl: item.visual_url,
          imageDataUrl: options.instagramImageDataUrl,
          caption: `${item.hook}\n\n${item.caption}\n\n${item.hashtags}`,
          format: item.format,
        })
      }
      result.instagram = "published"
    } catch {
      result.instagram = "error"
    }
  }

  if (channelsToTry.includes("google_business")) {
    try {
      await createGoogleBusinessPost(supabase, { summary: item.google_text })
      result.google_business = "published"
    } catch {
      result.google_business = "error"
    }
  }

  const allPublished = channelsToTry.length > 0 && channelsToTry.every(channel => result[channel] === "published")
  const nextItem: ContentItem = {
    ...item,
    auto_publish_result: result,
    status: allPublished ? "published" : item.status,
    updated_at: new Date().toISOString(),
  }
  return { item: nextItem, allPublished }
}
