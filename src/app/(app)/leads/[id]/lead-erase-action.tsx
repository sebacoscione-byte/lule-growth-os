"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, ShieldAlert } from "lucide-react"

export function LeadEraseAction({ leadId, leadLabel }: { leadId: string; leadLabel: string }) {
  const router = useRouter()
  const [erasing, setErasing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleErase() {
    const confirmed = window.confirm(
      `¿Eliminar todos los datos de "${leadLabel}"?\n\n` +
      "Esto borra el lead, la conversación de WhatsApp y las derivaciones a humano asociadas, " +
      "y desvincula el teléfono de los eventos de costo/consentimiento (quedan como \"erased\" " +
      "para no perder los totales históricos). Esta acción no se puede deshacer."
    )
    if (!confirmed) return

    setErasing(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}/erase`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "No se pudo eliminar el lead")
      }
      router.push("/leads")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el lead")
      setErasing(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        className="w-full border-red-300 text-red-700 hover:bg-red-50 text-xs"
        disabled={erasing}
        onClick={handleErase}
      >
        {erasing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5 mr-1" />}
        Eliminar datos de este paciente
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
