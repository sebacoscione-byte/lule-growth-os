import type { MetadataRoute } from "next"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

function getBaseUrl(): string {
  if (process.env.GOOGLE_OAUTH_BASE_URL) return process.env.GOOGLE_OAUTH_BASE_URL.replace(/\/$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return "https://draluciachahin.ar"
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getBaseUrl()
  const now = new Date()

  return PUBLIC_LANDING_SLUGS.map((slug) => ({
    url: `${base}/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: slug === "dra-lucia-chahin" ? 1.0 : 0.8,
  }))
}
