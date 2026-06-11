"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  MapPin,
  Camera,
  FileText,
  FlaskConical,
  Settings,
  Heart,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/google-local", label: "Google Local", icon: MapPin },
  { href: "/contenido/instagram", label: "Instagram", icon: Camera },
  { href: "/landings", label: "Landings", icon: FileText },
  { href: "/experimentos", label: "Experimentos", icon: FlaskConical },
  { href: "/configuracion", label: "Configuración", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
        <Heart className="h-5 w-5 text-rose-500" />
        <div>
          <p className="text-sm font-semibold text-gray-900">Lule Growth OS</p>
          <p className="text-xs text-gray-500">Dra. Lucía Chahin</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/")
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-gray-200 p-3">
        <p className="px-3 text-xs text-gray-400">© 2026 Lule Growth OS</p>
      </div>
    </aside>
  )
}
