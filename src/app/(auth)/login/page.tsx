"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Heart, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getMfaAccessDecision, safeMfaNextPath } from "@/lib/staff-mfa"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callbackError = searchParams.get("error") === "auth_callback"
    ? "El enlace de acceso venció o no es válido. Ingresá nuevamente."
    : searchParams.get("error") === "security_check"
      ? "No se pudo verificar la seguridad de la sesión. Ingresá nuevamente."
      : null
  const visibleError = error ?? callbackError

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError("Email o contraseña incorrectos")
      setLoading(false)
      return
    }

    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const decision = getMfaAccessDecision(
      assurance.data
        ? { currentLevel: assurance.data.currentLevel, nextLevel: assurance.data.nextLevel }
        : null
    )

    if (assurance.error || decision === "unavailable") {
      await supabase.auth.signOut({ scope: "local" })
      setError("No se pudo verificar la seguridad de la cuenta. Intentá de nuevo.")
      setLoading(false)
      return
    }

    const nextPath = safeMfaNextPath(searchParams.get("next"))
    if (decision === "step_up") {
      router.replace(`/seguridad/mfa?next=${encodeURIComponent(nextPath)}`)
      router.refresh()
      return
    }

    router.replace(nextPath)
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
              <Heart className="h-6 w-6 text-rose-500" />
            </div>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Lule Growth OS</h1>
          <p className="mt-1 text-sm text-gray-500">Dra. Lucía Chahin</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="lucia@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {visibleError && (
            <p className="text-sm text-red-600">{visibleError}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ingresar"}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  )
}
