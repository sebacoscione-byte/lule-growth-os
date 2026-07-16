"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2, LogOut, Plus, ShieldCheck, ShieldX, Smartphone, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import {
  getMfaGateDecision,
  mfaErrorMessage,
  normalizeTotpCode,
  safeMfaNextPath,
  totpQrDataUrl,
  unverifiedTotpFactors,
  verifiedTotpFactors,
} from "@/lib/staff-mfa"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface MfaFactor {
  id: string
  factor_type: string
  status: string
  friendly_name?: string
  created_at: string
}

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

interface MfaFlowProps {
  email: string
  roleLabel: string
  nextPath: string
  manage: boolean
  policyRequiresMfa: boolean
  policyAvailable: boolean
}

function factorLabel(factor: MfaFactor, index: number): string {
  return factor.friendly_name?.trim() || `Dispositivo ${index + 1}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Fecha no disponible"
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date)
}

export function MfaFlow({
  email,
  roleLabel,
  nextPath,
  manage,
  policyRequiresMfa,
  policyAvailable,
}: MfaFlowProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const safeNext = safeMfaNextPath(nextPath)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [factors, setFactors] = useState<MfaFactor[]>([])
  const [currentLevel, setCurrentLevel] = useState<string | null>(null)
  const [selectedFactorId, setSelectedFactorId] = useState("")
  const [code, setCode] = useState("")
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)

  const verified = verifiedTotpFactors(factors)
  const pending = unverifiedTotpFactors(factors)
  const hasUnsupportedVerifiedFactor = factors.some(
    factor => factor.status === "verified" && factor.factor_type !== "totp"
  )

  const loadStatus = useCallback(async () => {
    // Mantiene la carga inicial asíncrona incluso cuando se invoca desde el efecto de montaje.
    await Promise.resolve()
    setLoading(true)
    setError(null)
    try {
      const [factorResult, assuranceResult] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ])

      if (factorResult.error || assuranceResult.error || !factorResult.data || !assuranceResult.data) {
        setError("No se pudo verificar el estado de seguridad de la cuenta.")
        return
      }

      const nextFactors = factorResult.data.all as MfaFactor[]
      const nextVerified = verifiedTotpFactors(nextFactors)
      const decision = getMfaGateDecision(
        {
          currentLevel: assuranceResult.data.currentLevel,
          nextLevel: assuranceResult.data.nextLevel,
        },
        policyRequiresMfa
      )

      setFactors(nextFactors)
      setCurrentLevel(assuranceResult.data.currentLevel)
      setSelectedFactorId(previous =>
        nextVerified.some(factor => factor.id === previous) ? previous : (nextVerified[0]?.id ?? "")
      )

      if (decision === "unavailable") {
        setError("La sesión no tiene un nivel de seguridad válido. Cerrá sesión e ingresá de nuevo.")
        return
      }
      if (decision === "allow" && !manage) {
        router.replace(safeNext)
        router.refresh()
      }
    } catch {
      setError("No se pudo verificar el estado de seguridad de la cuenta.")
    } finally {
      setLoading(false)
    }
  }, [manage, policyRequiresMfa, router, safeNext, supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [loadStatus])

  async function signOut() {
    setBusy(true)
    try {
      await supabase.auth.signOut({ scope: "local" })
    } finally {
      router.replace("/login")
      router.refresh()
    }
  }

  async function verifyExistingFactor(event: React.FormEvent) {
    event.preventDefault()
    const normalizedCode = normalizeTotpCode(code)
    if (!normalizedCode || !selectedFactorId) {
      setError("Ingresá el código de seis dígitos de tu aplicación.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: selectedFactorId,
        code: normalizedCode,
      })
      if (result.error) {
        setError(mfaErrorMessage(result.error))
        return
      }

      setCode("")
      setNotice("Segundo factor verificado.")
      await loadStatus()
    } catch {
      setError("No se pudo completar la verificación de seguridad. Intentá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  async function startEnrollment() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Relee justo antes de limpiar para no borrar un factor que otra pestaña ya verificó.
      const latestFactors = await supabase.auth.mfa.listFactors()
      if (latestFactors.error || !latestFactors.data) {
        setError("No se pudo validar la configuración actual.")
        return
      }
      const latestPending = unverifiedTotpFactors(latestFactors.data.all as MfaFactor[])
      for (const factor of latestPending) {
        const cleanup = await supabase.auth.mfa.unenroll({ factorId: factor.id })
        if (cleanup.error) {
          setError("No se pudo reiniciar la configuración incompleta.")
          return
        }
      }

      const result = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Lule ${new Date().toISOString()}`,
        issuer: "Lule Growth OS",
      })
      if (result.error || !result.data) {
        setError(mfaErrorMessage(result.error))
        return
      }

      const qrCode = totpQrDataUrl(result.data.totp.qr_code)
      if (!qrCode) {
        await supabase.auth.mfa.unenroll({ factorId: result.data.id })
        setError("No se pudo generar un código QR seguro. Intentá nuevamente.")
        return
      }

      setEnrollment({
        factorId: result.data.id,
        qrCode,
        secret: result.data.totp.secret,
      })
      setCode("")
    } catch {
      setError("No se pudo iniciar la configuración de seguridad. Intentá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  async function cancelEnrollment() {
    if (!enrollment) return
    setBusy(true)
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
      if (result.error) {
        setError("No se pudo cancelar la configuración. Intentá de nuevo.")
        return
      }
      setEnrollment(null)
      setCode("")
      await loadStatus()
    } catch {
      setError("No se pudo cancelar la configuración. Intentá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  async function verifyEnrollment(event: React.FormEvent) {
    event.preventDefault()
    const normalizedCode = normalizeTotpCode(code)
    if (!enrollment || !normalizedCode) {
      setError("Ingresá el código de seis dígitos de tu aplicación.")
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollment.factorId,
        code: normalizedCode,
      })
      if (result.error) {
        setError(mfaErrorMessage(result.error))
        return
      }

      setEnrollment(null)
      setCode("")
      setNotice("Autenticación en dos pasos activada para este dispositivo.")
      await loadStatus()
    } catch {
      setError("No se pudo completar la verificación de seguridad. Intentá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  async function removeFactor(factor: MfaFactor) {
    if (policyRequiresMfa && verified.length <= 1) {
      setError("La política de seguridad no permite quitar el último dispositivo.")
      return
    }
    if (!window.confirm(`¿Quitar ${factor.friendly_name || "este dispositivo"}?`)) return

    setBusy(true)
    setError(null)
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (result.error) {
        setError(mfaErrorMessage(result.error))
        return
      }

      const refreshed = await supabase.auth.refreshSession()
      if (refreshed.error) {
        await supabase.auth.signOut({ scope: "local" })
        router.replace("/login")
        router.refresh()
        return
      }

      setNotice("Dispositivo eliminado.")
      await loadStatus()
    } catch {
      setError("No se pudo quitar el dispositivo. Intentá de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" aria-label="Verificando seguridad" />
      </div>
    )
  }

  if (hasUnsupportedVerifiedFactor && verified.length === 0 && currentLevel !== "aal2") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Método de seguridad no compatible</CardTitle>
            <CardDescription>
              Esta cuenta tiene un factor distinto de TOTP. Lule sólo admite aplicaciones autenticadoras; un administrador debe revisar la cuenta antes de continuar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={signOut} disabled={busy} className="w-full">
              <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const needsChallenge = verified.length > 0 && currentLevel !== "aal2"
  const canManage = currentLevel === "aal2"
  const needsSetup = verified.length === 0 || enrollment !== null

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-2.5"><ShieldCheck className="h-6 w-6 text-blue-700" /></div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Seguridad de la cuenta</h1>
              <p className="text-sm text-gray-500">{email} · {roleLabel}</p>
            </div>
          </div>
          {!policyAvailable && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No se pudo leer la política global. Podés configurar o verificar tu factor, pero el CRM seguirá bloqueado hasta recuperarla.
            </p>
          )}
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {notice && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
        </header>

        {needsChallenge && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Verificá tu identidad</CardTitle>
              <CardDescription>Ingresá un código actual de cualquiera de tus aplicaciones autenticadoras.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={verifyExistingFactor} className="space-y-4">
                {verified.length > 1 && (
                  <div className="space-y-2">
                    <Label htmlFor="factor">Dispositivo</Label>
                    <select
                      id="factor"
                      value={selectedFactorId}
                      onChange={event => setSelectedFactorId(event.target.value)}
                      className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    >
                      {verified.map((factor, index) => (
                        <option key={factor.id} value={factor.id}>{factorLabel(factor, index)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="challenge-code">Código de seis dígitos</Label>
                  <Input
                    id="challenge-code"
                    value={code}
                    onChange={event => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="000000"
                    autoFocus
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="submit" disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verificar
                  </Button>
                  <Button type="button" variant="outline" onClick={signOut} disabled={busy}>
                    <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {needsSetup && !needsChallenge && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Configurar aplicación autenticadora</CardTitle>
              <CardDescription>
                Usá Google Authenticator, Microsoft Authenticator, 1Password u otra app compatible con TOTP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!enrollment ? (
                <>
                  {pending.length > 0 && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                      Hay una configuración incompleta. Al continuar se descartará y se generará un QR nuevo.
                    </p>
                  )}
                  <Button type="button" onClick={startEnrollment} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Generar código QR
                  </Button>
                </>
              ) : (
                <form onSubmit={verifyEnrollment} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-center">
                    <div className="rounded-lg border bg-white p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- QR efímero data: generado por Supabase */}
                      <img src={enrollment.qrCode} alt="Código QR para configurar el autenticador" className="h-auto w-full" />
                    </div>
                    <div className="space-y-3 text-sm text-gray-600">
                      <p>1. Escaneá el QR con tu aplicación.</p>
                      <p>2. Si no podés escanearlo, cargá esta clave manualmente:</p>
                      <code className="block break-all rounded-md bg-gray-100 p-3 font-mono text-xs text-gray-900">{enrollment.secret}</code>
                      <p>3. Ingresá abajo el código que cambia cada 30 segundos.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="enrollment-code">Código de seis dígitos</Label>
                    <Input
                      id="enrollment-code"
                      value={code}
                      onChange={event => setCode(event.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      placeholder="000000"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="submit" disabled={busy}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Activar y verificar
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelEnrollment} disabled={busy}>Cancelar</Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {canManage && !enrollment && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Dispositivos de seguridad</CardTitle>
                <Badge variant="success">Sesión AAL2</Badge>
              </div>
              <CardDescription>
                Recomendación: configurá un segundo autenticador de respaldo, especialmente para cuentas responsables.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {verified.map((factor, index) => (
                <div key={factor.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{factorLabel(factor, index)}</p>
                    <p className="text-xs text-gray-500">Configurado el {formatDate(factor.created_at)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeFactor(factor)}
                    disabled={busy || (policyRequiresMfa && verified.length <= 1)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Quitar
                  </Button>
                </div>
              ))}
              {verified.length < 2 && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <ShieldX className="mt-0.5 h-4 w-4 shrink-0" /> Todavía no hay un autenticador de respaldo.
                </p>
              )}
              {verified.length < 10 && (
                <Button type="button" variant="outline" onClick={startEnrollment} disabled={busy}>
                  <Plus className="mr-2 h-4 w-4" /> Agregar otro dispositivo
                </Button>
              )}
              <p className="text-xs text-gray-500">
                Si perdés acceso a todos los dispositivos, la recuperación requiere validar tu identidad con un administrador. Cambiar la contraseña no elimina el segundo factor.
              </p>
              <Button type="button" onClick={() => { router.replace(safeNext); router.refresh() }}>Volver al sistema</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
