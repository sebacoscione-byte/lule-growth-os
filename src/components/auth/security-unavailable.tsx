"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogOut, RefreshCw, ShieldAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

export function SecurityUnavailable() {
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
      <section className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <ShieldAlert className="h-10 w-10 text-amber-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-gray-900">No pudimos verificar la seguridad</h1>
        <p className="mt-2 text-sm text-gray-600">
          Para proteger los datos de pacientes, el sistema queda bloqueado hasta validar tu sesión.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button type="button" onClick={() => router.refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
          </Button>
          <Button type="button" variant="outline" onClick={signOut} disabled={signingOut}>
            {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
            Cerrar sesión
          </Button>
        </div>
      </section>
    </main>
  )
}
