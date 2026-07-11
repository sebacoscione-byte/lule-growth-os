import type { MetadataRoute } from "next"

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
          "/dra-lucia-chahin",
          "/cardiologa-lanus",
          "/cardiologa-lomas",
          "/ecocardiograma-lanus",
          "/ecocardiograma-lomas",
          "/consulta-cardiologica-lanus",
          "/consulta-cardiologica-lomas",
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
