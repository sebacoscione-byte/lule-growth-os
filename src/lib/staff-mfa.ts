export type MfaAssuranceLevel = "aal1" | "aal2" | null

export interface MfaAssuranceSnapshot {
  currentLevel: MfaAssuranceLevel | string
  nextLevel: MfaAssuranceLevel | string
}

export interface MfaFactorSummary {
  id: string
  factor_type: string
  status: string
}

export type MfaAccessDecision = "allow" | "step_up" | "unavailable"
export type MfaGateDecision = MfaAccessDecision | "setup"

const DEFAULT_NEXT_PATH = "/dashboard"

export function getMfaAccessDecision(
  snapshot: MfaAssuranceSnapshot | null | undefined
): MfaAccessDecision {
  if (!snapshot) return "unavailable"
  if (snapshot.currentLevel === "aal2") return "allow"
  if (snapshot.currentLevel === "aal1" && snapshot.nextLevel === "aal2") return "step_up"
  if (snapshot.currentLevel === "aal1" && snapshot.nextLevel === "aal1") return "allow"
  return "unavailable"
}

export function getMfaGateDecision(
  snapshot: MfaAssuranceSnapshot | null | undefined,
  policyRequiresMfa: boolean
): MfaGateDecision {
  const access = getMfaAccessDecision(snapshot)
  if (access !== "allow") return access
  if (snapshot?.currentLevel === "aal1" && policyRequiresMfa) return "setup"
  return "allow"
}

/** Evita open redirects y bucles hacia las propias rutas de autenticación. */
export function safeMfaNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_NEXT_PATH
  }

  try {
    const parsed = new URL(value, "https://lule.local")
    if (
      parsed.origin !== "https://lule.local"
      || parsed.pathname.startsWith("/login")
      || parsed.pathname.startsWith("/seguridad/mfa")
    ) {
      return DEFAULT_NEXT_PATH
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_NEXT_PATH
  }
}

export function normalizeTotpCode(value: string): string | null {
  const normalized = value.replace(/[\s-]/g, "")
  return /^\d{6}$/.test(normalized) ? normalized : null
}

export function verifiedTotpFactors<T extends MfaFactorSummary>(factors: readonly T[]): T[] {
  return factors.filter(factor => factor.factor_type === "totp" && factor.status === "verified")
}

export function unverifiedTotpFactors<T extends MfaFactorSummary>(factors: readonly T[]): T[] {
  return factors.filter(factor => factor.factor_type === "totp" && factor.status === "unverified")
}

/** Supabase puede devolver el SVG crudo o un data URL según la versión del cliente. */
export function totpQrDataUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.startsWith("data:image/svg+xml")) return trimmed
  if (trimmed.startsWith("<svg") && trimmed.endsWith("</svg>")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`
  }
  return null
}

const STAFF_ROLE_LABELS: Record<string, string> = {
  owner: "Responsable",
  doctor: "Profesional médica",
  reception: "Recepción",
  research: "Investigación",
  viewer: "Solo lectura",
}

export function staffRoleLabel(value: unknown): string {
  return typeof value === "string" && STAFF_ROLE_LABELS[value]
    ? STAFF_ROLE_LABELS[value]
    : "Rol pendiente de asignación"
}

interface SafeAuthError {
  code?: string
}

/** Traduce errores conocidos sin filtrar mensajes internos del proveedor. */
export function mfaErrorMessage(error: SafeAuthError | null | undefined): string {
  switch (error?.code) {
    case "mfa_verification_failed":
      return "El código no es válido. Revisalo en tu aplicación e intentá de nuevo."
    case "mfa_challenge_expired":
      return "El desafío venció. Generá un código nuevo e intentá otra vez."
    case "mfa_factor_name_conflict":
      return "Ya existe un dispositivo con ese nombre. Volvé a iniciar la configuración."
    case "mfa_ip_address_mismatch":
      return "La verificación cambió de red. Volvé a iniciar el proceso."
    case "too_many_enrolled_mfa_factors":
      return "La cuenta alcanzó el máximo de dispositivos de seguridad."
    case "over_request_rate_limit":
      return "Hubo demasiados intentos. Esperá unos minutos antes de reintentar."
    default:
      return "No se pudo completar la verificación de seguridad. Intentá de nuevo."
  }
}
