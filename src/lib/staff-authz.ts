import type { SupabaseClient, User } from "@supabase/supabase-js"
import { getServiceDb } from "@/lib/supabase/service"

export const STAFF_ROLES = ["owner", "doctor", "reception", "research", "viewer"] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export interface StaffAuthorizationOptions {
  allowedRoles: readonly StaffRole[]
  /** Operaciones que modifican o exportan datos identificables. */
  sensitive?: boolean
}

export interface AuthorizedStaff {
  ok: true
  user: User
  role: StaffRole
  legacyCompatibility: boolean
  assuranceLevel: "aal1" | "aal2" | null
}

export interface StaffAuthorizationFailure {
  ok: false
  status: 401 | 403 | 503
  code: "unauthorized" | "role_required" | "forbidden" | "mfa_required" | "authz_unavailable"
  error: string
}

export type StaffAuthorization = AuthorizedStaff | StaffAuthorizationFailure

export interface StaffSecurityPolicy {
  enforce_roles: boolean
  require_mfa_for_sensitive_actions: boolean
}

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value)
}

/**
 * Fuente única del rol: `app_metadata.role`, firmado por Supabase Auth. Deliberadamente no se
 * consulta `user_metadata`, que el propio usuario puede modificar.
 */
export function roleFromAppMetadata(user: Pick<User, "app_metadata">): StaffRole | null {
  const role = user.app_metadata?.role
  return isStaffRole(role) ? role : null
}

/** Lectura server-only de la política global. Falla cerrado si la fila no está disponible. */
export async function getStaffSecurityPolicy(): Promise<StaffSecurityPolicy> {
  const db = getServiceDb()
  const { data, error } = await db
    .from("security_authorization_settings")
    .select("enforce_roles, require_mfa_for_sensitive_actions")
    .eq("id", "global")
    .maybeSingle()

  // El modo compatible vive en la fila explícita con flags=false. Una tabla ausente, un error o
  // una fila borrada fallan cerrados; el código y su migración deben desplegarse juntos.
  if (error) throw new Error("authz_settings_unavailable")
  if (!data) throw new Error("authz_settings_missing")
  return {
    enforce_roles: data.enforce_roles === true,
    require_mfa_for_sensitive_actions: data.require_mfa_for_sensitive_actions === true,
  }
}

function failure(
  status: StaffAuthorizationFailure["status"],
  code: StaffAuthorizationFailure["code"],
  error: string
): StaffAuthorizationFailure {
  return { ok: false, status, code, error }
}

/** Autoriza una ruta server-side y, si corresponde, verifica AAL2 con Supabase MFA. */
export async function authorizeStaff(
  supabase: Pick<SupabaseClient, "auth">,
  options: StaffAuthorizationOptions
): Promise<StaffAuthorization> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return failure(401, "unauthorized", "Unauthorized")

  let settings: StaffSecurityPolicy
  try {
    settings = await getStaffSecurityPolicy()
  } catch {
    return failure(503, "authz_unavailable", "No se pudo verificar la autorización")
  }

  const assignedRole = roleFromAppMetadata(user)
  if (settings.enforce_roles && !assignedRole) {
    return failure(403, "role_required", "Tu cuenta todavía no tiene un rol habilitado")
  }

  // Mientras el backfill no se haya activado, un usuario histórico sin rol conserva el acceso
  // previo. Un rol explícito siempre se respeta, incluso durante la transición.
  const role = assignedRole ?? "owner"
  if (!options.allowedRoles.includes(role)) {
    return failure(403, "forbidden", "No tenés permisos para esta acción")
  }

  let assuranceLevel: "aal1" | "aal2" | null = null
  if (options.sensitive && settings.require_mfa_for_sensitive_actions) {
    const getAal = supabase.auth.mfa?.getAuthenticatorAssuranceLevel
    if (typeof getAal !== "function") {
      return failure(503, "authz_unavailable", "No se pudo verificar el segundo factor")
    }
    try {
      const { data, error } = await getAal.call(supabase.auth.mfa)
      if (error) return failure(503, "authz_unavailable", "No se pudo verificar el segundo factor")
      const currentLevel = data?.currentLevel
      assuranceLevel = currentLevel === "aal1" || currentLevel === "aal2"
        ? currentLevel as "aal1" | "aal2"
        : null
    } catch {
      return failure(503, "authz_unavailable", "No se pudo verificar el segundo factor")
    }
    if (assuranceLevel !== "aal2") {
      return failure(403, "mfa_required", "Esta acción requiere autenticación de dos factores")
    }
  }

  return {
    ok: true,
    user,
    role,
    legacyCompatibility: !settings.enforce_roles && !assignedRole,
    assuranceLevel,
  }
}
