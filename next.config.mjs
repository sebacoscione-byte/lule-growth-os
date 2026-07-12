/** @type {import('next').NextConfig} */
const nextConfig = {
  // TECH-01 (docs/BACKLOG.md): headers de seguridad generales, sin tocar Content-Security-Policy.
  // Un CSP mal armado puede romper en silencio el OAuth de Google/Instagram, Google Analytics,
  // las fotos de Google Places o las imágenes de Supabase Storage — y este entorno no tiene forma
  // de probar esos flujos de punta a punta (sin credenciales de login). Los headers de abajo no
  // interactúan con ninguno de esos flujos: no restringen scripts/estilos/orígenes de conexión,
  // solo endurecen comportamiento del navegador que no depende de una lista de dominios permitidos.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Evita que el navegador "adivine" un content-type distinto al declarado (protección
          // clásica contra XSS por MIME-sniffing en archivos subidos, ej. content-media).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No manda la URL completa (que puede incluir tokens en query params, ej. callbacks de
          // OAuth) como referrer a un origen distinto; sí la manda completa entre páginas propias.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Evita que el sitio se embeba en un iframe ajeno (clickjacking). No afecta al OAuth de
          // Google/Instagram: ambos redirigen la ventana completa (top-level), nunca embeben esta
          // app en un iframe propio.
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
