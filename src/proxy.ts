import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

const PUBLIC_ROOT_PATHS = new Set(PUBLIC_LANDING_SLUGS.map((slug) => `/${slug}`))
const PUBLIC_LEGAL_PATHS = new Set(["/privacidad", "/terminos", "/eliminar-datos"])

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Primer segmento del path: además de la landing en sí (/cardiologa-lanus), cubre los archivos
  // de metadata que Next.js genera anidados bajo la misma ruta (ej. /cardiologa-lanus/opengraph-image),
  // que un match exacto sobre PUBLIC_ROOT_PATHS dejaba afuera y mandaba a /login sin sesión.
  const firstSegment = "/" + request.nextUrl.pathname.split("/")[1]

  const isLoginRoute = request.nextUrl.pathname === "/login"
  const isMfaRoute = request.nextUrl.pathname.startsWith("/seguridad/mfa")
  // Archivo de verificacion de Google Search Console (convencion google-site-verification):
  // se sirve desde public/, pero sin esta excepcion el gate de auth lo redirige a /login antes de
  // que Next.js llegue a servirlo -- mismo bug ya visto con /sitemap.xml y /robots.txt.
  const isGoogleSiteVerificationFile = /^\/google[a-f0-9]{16}\.html$/.test(request.nextUrl.pathname)
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/landings") ||
    request.nextUrl.pathname.startsWith("/go/") ||
    request.nextUrl.pathname.startsWith("/api") ||
    request.nextUrl.pathname === "/" ||
    PUBLIC_LEGAL_PATHS.has(request.nextUrl.pathname) ||
    request.nextUrl.pathname === "/sitemap.xml" ||
    request.nextUrl.pathname === "/robots.txt" ||
    isGoogleSiteVerificationFile ||
    PUBLIC_ROOT_PATHS.has(firstSegment)

  if (!user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone()
    url.pathname = "/dra-lucia-chahin"
    // 308 (permanente), no el 307 default: Search Console mostraba "/" como la página indexada
    // y "/dra-lucia-chahin" como duplicada con canónica distinta a la declarada -- un 307 le dice
    // a Google que no consolide la indexación en el destino porque podría cambiar.
    return NextResponse.redirect(url, 308)
  }

  if (!user && !isLoginRoute && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    if (isMfaRoute || !request.nextUrl.pathname.startsWith("/api")) {
      url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`)
    }
    return NextResponse.redirect(url)
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

// El nombre de este export sigue siendo "config" (no "proxyConfig") en Next.js 16.2.9 —
// verificado directamente en node_modules/next/dist/build/analysis/get-page-static-info.js,
// que busca literalmente el identificador "config" para extraer el matcher, incluso dentro de
// proxy.ts. Solo el nombre de la función exportada cambia (proxy en vez de middleware).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
