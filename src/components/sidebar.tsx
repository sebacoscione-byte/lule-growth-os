"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Camera,
  DollarSign,
  FileText,
  FlaskConical,
  Heart,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageSquare,
  Settings,
  Users,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/costos", label: "Costos WhatsApp", icon: DollarSign },
  { href: "/google-local", label: "Google Local", icon: MapPin },
  { href: "/contenido/instagram", label: "Contenido", icon: Camera },
  { href: "/landings", label: "Landings", icon: FileText },
  { href: "/experimentos", label: "Experimentos", icon: FlaskConical },
  { href: "/configuracion", label: "Configuración", icon: Settings },
] as const

const MOBILE_NAV_ITEMS = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/google-local", label: "Google", icon: MapPin },
] as const

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

export function Sidebar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const secondaryActive = NAV_ITEMS
    .filter(item => !MOBILE_NAV_ITEMS.some(primary => primary.href === item.href))
    .some(item => isActive(pathname, item.href))

  return (
    <>
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
          <Heart className="h-5 w-5 text-rose-500" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Lule Growth OS</p>
            <p className="text-xs text-gray-500">Dra. Lucía Chahin</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive(pathname, href)
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-gray-200 p-3">
          <p className="px-3 text-xs text-gray-400">© 2026 Lule Growth OS</p>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE_NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  isActive(pathname, href) ? "text-blue-600" : "text-gray-400"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={cn(
                "flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                secondaryActive ? "text-blue-600" : "text-gray-400"
              )}
            >
              <Menu className="h-5 w-5" />
              Más
            </button>
          </li>
        </ul>
      </nav>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-slate-950/40"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-rose-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Todas las secciones</p>
                  <p className="text-xs text-gray-500">Lule Growth OS</p>
                </div>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Cerrar menú" className="rounded-full p-2 text-gray-500 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-xl border p-3 text-sm font-medium",
                    isActive(pathname, href) ? "border-blue-200 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-700"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
