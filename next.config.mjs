// Content-Security-Policy (cierra el trabajo futuro explícito que dejó TECH-01, 2026-07-18).
//
// Inventario real de orígenes externos que el NAVEGADOR carga (verificado archivo por archivo —
// las llamadas server-side a Gemini/Meta/Google Business no pasan por CSP, eso es fetch del server):
// - Scripts: gtag.js desde www.googletagmanager.com (solo páginas públicas, solo con consentimiento
//   — ver google-analytics.tsx) + los scripts inline de hidratación de Next.
// - Conexiones: Supabase desde el browser (login/MFA vía @supabase/ssr) + los endpoints de GA4.
// - Imágenes: Supabase Storage (placas de content-media, `visual_url`), `data:` (QR de MFA,
//   previews de placas recién generadas) y el pixel de GA. Las reseñas de Google Places NO traen
//   fotos (solo displayName, ver google-places.ts) y la landing usa una imagen local.
// - No hay iframes, workers, ni media externos en ninguna página.
//
// Decisiones deliberadas:
// - `script-src` lleva 'unsafe-inline' (sin nonces): Next App Router inyecta scripts inline de
//   bootstrap y el patrón de nonce requiere mover el header al proxy y propagarlo por request —
//   más riesgo de romper algo en silencio que beneficio hoy. El valor real de este CSP está en
//   `connect-src`/`form-action`/`object-src`/`frame-src`: aunque se inyectara un script, no puede
//   exfiltrar datos a un origen arbitrario ni embeber contenido ajeno.
// - En desarrollo (`next dev`) se suma 'unsafe-eval' (source maps de Turbopack) y ws:/wss: (HMR).
//   El header de producción no los incluye.
// - En previews de Vercel se permite https://vercel.live (toolbar de preview que Vercel inyecta);
//   en producción no.
// - El OAuth de Google/Instagram no aparece en la lista a propósito: ambos son redirects
//   top-level (navegación completa), que CSP no restringe. `form-action 'self'` no los afecta —
//   el login postea a Supabase vía fetch (connect-src), no vía <form action>.

const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin
  } catch {
    return ""
  }
})()

const isDev = process.env.NODE_ENV !== "production"
const isVercelPreview = process.env.VERCEL_ENV === "preview"

const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""}${isVercelPreview ? " https://vercel.live" : ""}`,
  `style-src 'self' 'unsafe-inline'${isVercelPreview ? " https://vercel.live" : ""}`,
  `img-src 'self' data: blob: ${supabaseOrigin} https://www.google-analytics.com https://www.googletagmanager.com`.trim(),
  // Video del reel (content-media en Supabase Storage) para el preview en el editor -- sin esto, el
  // <video> del editor queda bloqueado por CSP (media-src cae a default-src 'self' si no se declara).
  `media-src 'self' ${supabaseOrigin}`.trim(),
  `font-src 'self' data:${isVercelPreview ? " https://vercel.live https://assets.vercel.com" : ""}`,
  `connect-src 'self' ${supabaseOrigin} https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net${isDev ? " ws: wss:" : ""}${isVercelPreview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`.trim(),
  `frame-src ${isVercelPreview ? "https://vercel.live" : "'none'"}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'self'`,
]
  .join("; ")
  // Si NEXT_PUBLIC_SUPABASE_URL faltara en build, no dejar un hueco doble-espacio en el header.
  .replace(/\s{2,}/g, " ")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @ffmpeg-installer/@ffprobe-installer resuelven el binario con un require() dinámico segun
  // plataforma/arquitectura -- Turbopack intenta bundlear ese require estaticamente y falla ("Unknown
  // module type" sobre el .exe/README del paquete de plataforma). serverExternalPackages le dice a
  // Next que los deje como require() reales de node_modules en tiempo de ejecucion, sin bundlearlos.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe"],
  // /api/content/video (burnVideoBrief en video-caption.ts) usa ffmpeg/ffprobe (binarios de
  // @ffmpeg-installer / @ffprobe-installer, resueltos dinámicamente según plataforma -- el tracer
  // automático de Next suele seguirlos bien) y una fuente propia para quemar texto
  // (DejaVuSans-Bold.ttf, referenciada solo por ruta de archivo dentro de video-caption.ts, nunca
  // importada -- el tracer automático NO tiene forma de detectarla sola). Sin esto, el deploy de
  // Vercel puede arrancar sin el archivo y fallar recién al primer uso real, no en build.
  outputFileTracingIncludes: {
    "/api/content/video": [
      "src/lib/fonts/DejaVuSans-Bold.ttf",
      "node_modules/@ffmpeg-installer/**",
      "node_modules/@ffprobe-installer/**",
    ],
  },
  // TECH-01 (docs/BACKLOG.md): headers de seguridad generales. El CSP de arriba se sumó después
  // (2026-07-18) una vez que este entorno pudo probar login/OAuth/GA de punta a punta.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Evita que el navegador "adivine" un content-type distinto al declarado (protección
          // clásica contra XSS por MIME-sniffing en archivos subidos, ej. content-media).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No manda la URL completa (que puede incluir tokens en query params, ej. callbacks de
          // OAuth) como referrer a un origen distinto; sí la manda completa entre páginas propias.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Evita que el sitio se embeba en un iframe ajeno (clickjacking). Redundante con
          // `frame-ancestors 'self'` del CSP, se mantiene por compatibilidad con navegadores viejos.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Solo deniega permisos del navegador que la app no usa en ningún lado (verificado:
          // no hay cámara/micrófono/geolocalización en el código). Todo lo demás — incluido
          // clipboard-write, que sí se usa en los botones "Copiar" — queda en el default del
          // navegador, sin restringir nada.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
}

export default nextConfig
