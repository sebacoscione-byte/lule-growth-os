import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Sanea texto libre antes de interpolarlo en un filtro `.or()` de PostgREST:
// coma y paréntesis delimitan condiciones, así que dejarlos pasar permite
// inyectar filtros adicionales (ej: "x,status.eq.confirmo_que_pidio_turno").
export function sanitizePostgrestValue(input: string) {
  return input.replace(/[,()]/g, "").trim()
}

export function formatDate(date: string | null) {
  if (!date) return "—"
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}

export function formatDateShort(date: string | null) {
  if (!date) return "—"
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date))
}

export function timeAgo(date: string) {
  const now = new Date()
  const d = new Date(date)
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (diff < 60) return "hace un momento"
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`
  return formatDateShort(date)
}
