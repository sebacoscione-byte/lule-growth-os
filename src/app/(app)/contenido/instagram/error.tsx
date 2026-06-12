"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function InstagramError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[Instagram page error]", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 text-center">
        <div className="flex justify-center">
          <AlertTriangle className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Error al cargar el Estudio de Contenido</h2>
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-left">
          <p className="text-sm font-mono text-red-700 break-all">{error.message}</p>
          {error.digest && (
            <p className="text-xs text-red-500 mt-1">ID: {error.digest}</p>
          )}
        </div>
        <Button onClick={reset} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      </div>
    </div>
  )
}
