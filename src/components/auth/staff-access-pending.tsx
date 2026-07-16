"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogOut, UserRoundCog } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function StaffAccessPending() {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut({ scope: "local" })
    router.replace("/login")
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <section className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <UserRoundCog className="h-10 w-10 text-blue-700" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Acceso pendiente</h1>
        <p className="mt-2 text-sm text-gray-600">
          La cuenta está autenticada, pero todavía no tiene un rol de personal asignado. Un responsable debe habilitarla antes de acceder a datos del sistema.
        </p>
        <Button type="button" variant="outline" onClick={signOut} disabled={signingOut} className="mt-6 w-full">
          {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          Cerrar sesión
        </Button>
      </section>
    </main>
  )
}
