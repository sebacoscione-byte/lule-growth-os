import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"
import { HERO_VARIANT_COOKIE } from "@/lib/landing-track"

const PUBLIC_ROOT_PATHS = new Set(PUBLIC_LANDING_SLUGS.map((slug) => `/${slug}`))

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

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login")
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/landings") ||
    request.nextUrl.pathname.startsWith("/go/") ||
    request.nextUrl.pathname.startsWith("/api") ||
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/privacidad" ||
    request.nextUrl.pathname === "/sitemap.xml" ||
    request.nextUrl.pathname === "/robots.txt" ||
    PUBLIC_ROOT_PATHS.has(firstSegment)

  const isLandingRoute =
    request.nextUrl.pathname.startsWith("/landings/") ||
    PUBLIC_ROOT_PATHS.has(request.nextUrl.pathname)

  if (isLandingRoute) {
    const existingVariant = request.cookies.get(HERO_VARIANT_COOKIE)?.value
    if (existingVariant !== "a" && existingVariant !== "b") {
      const variant = Math.random() < 0.5 ? "a" : "b"
      const previousCookies = supabaseResponse.cookies.getAll()
      request.cookies.set(HERO_VARIANT_COOKIE, variant)
      supabaseResponse = NextResponse.next({ request })
      previousCookies.forEach((cookie) => supabaseResponse.cookies.set(cookie))
      supabaseResponse.cookies.set(HERO_VARIANT_COOKIE, variant, {
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
        sameSite: "lax",
      })
    }
  }

  if (!user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone()
    url.pathname = "/dra-lucia-chahin"
    return NextResponse.redirect(url)
  }

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
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
