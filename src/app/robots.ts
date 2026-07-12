import type { MetadataRoute } from "next"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

function getBaseUrl(): string {
  if (process.env.GOOGLE_OAUTH_BASE_URL) return process.env.GOOGLE_OAUTH_BASE_URL.replace(/\/$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "https://draluciachahin.ar"
}

export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl()
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          ...PUBLIC_LANDING_SLUGS.map((slug) => `/${slug}`),
          "/landings/",
          "/privacidad",
        ],
        disallow: [
          "/dashboard",
          "/leads",
          "/inbox",
          "/contenido",
          "/google-local",
          "/experimentos",
          "/configuracion",
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  }
}
