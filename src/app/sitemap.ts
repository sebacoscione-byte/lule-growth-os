import type { MetadataRoute } from "next"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

function getBaseUrl(): string {
  if (process.env.GOOGLE_OAUTH_BASE_URL) return process.env.GOOGLE_OAUTH_BASE_URL.replace(/\/$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "https://draluciachahin.ar"
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getBaseUrl()

  // No publicar `new Date()` como lastmod: el deploy del panel interno no implica que estas
  // páginas hayan cambiado. Google recomienda omitir la fecha cuando no puede ser exacta.
  return [
    ...PUBLIC_LANDING_SLUGS.map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "monthly" as const,
      priority: slug === "dra-lucia-chahin" ? 1.0 : 0.8,
    })),
    {
      url: `${base}/privacidad`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    },
    {
      url: `${base}/terminos`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    },
    {
      url: `${base}/eliminar-datos`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    },
  ]
}
