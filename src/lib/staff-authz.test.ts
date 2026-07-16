jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff, roleFromAppMetadata } from "@/lib/staff-authz"

function settings(result: { data: unknown; error: unknown }) {
  ;(getServiceDb as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue(result) })),
      })),
    })),
  })
}

function authClient(input: {
  user?: Record<string, unknown> | null
  userError?: unknown
  aal?: "aal1" | "aal2" | null
  aalError?: unknown
}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: input.user === undefined ? { id: "00000000-0000-4000-8000-000000000001", app_metadata: {} } : input.user },
        error: input.userError ?? null,
      }),
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
          data: { currentLevel: input.aal ?? "aal1", nextLevel: input.aal ?? "aal1" },
          error: input.aalError ?? null,
        }),
      },
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe("roleFromAppMetadata", () => {
  it("solo acepta roles cerrados desde app_metadata", () => {
    expect(roleFromAppMetadata({ app_metadata: { role: "doctor" } } as never)).toBe("doctor")
    expect(roleFromAppMetadata({ app_metadata: { role: "admin" } } as never)).toBeNull()
  })
})

describe("authorizeStaff", () => {
  it("mantiene compatibilidad para cuentas históricas mediante flags explícitos apagados", async () => {
    settings({ data: { enforce_roles: false, require_mfa_for_sensitive_actions: false }, error: null })
    const result = await authorizeStaff(authClient({}) as never, { allowedRoles: ["owner"] })
    expect(result).toEqual(expect.objectContaining({ ok: true, role: "owner", legacyCompatibility: true }))
  })

  it("falla cerrado si enforcement está activo y falta app_metadata.role", async () => {
    settings({ data: { enforce_roles: true, require_mfa_for_sensitive_actions: false }, error: null })
    const result = await authorizeStaff(authClient({}) as never, { allowedRoles: ["owner"] })
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 403, code: "role_required" }))
  })

  it("nunca usa user_metadata para elevar privilegios", async () => {
    settings({ data: { enforce_roles: true, require_mfa_for_sensitive_actions: false }, error: null })
    const result = await authorizeStaff(authClient({ user: {
      id: "00000000-0000-4000-8000-000000000001",
      app_metadata: { role: "viewer" },
      user_metadata: { role: "owner" },
    } }) as never, { allowedRoles: ["owner"] })
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "forbidden" }))
  })

  it("autoriza un rol permitido", async () => {
    settings({ data: { enforce_roles: true, require_mfa_for_sensitive_actions: false }, error: null })
    const result = await authorizeStaff(authClient({ user: {
      id: "00000000-0000-4000-8000-000000000001",
      app_metadata: { role: "doctor" },
    } }) as never, { allowedRoles: ["owner", "doctor"] })
    expect(result).toEqual(expect.objectContaining({ ok: true, role: "doctor", legacyCompatibility: false }))
  })

  it("exige AAL2 para acciones sensibles cuando MFA está habilitado", async () => {
    settings({ data: { enforce_roles: true, require_mfa_for_sensitive_actions: true }, error: null })
    const aal1 = await authorizeStaff(authClient({ user: {
      id: "00000000-0000-4000-8000-000000000001",
      app_metadata: { role: "owner" },
    }, aal: "aal1" }) as never, { allowedRoles: ["owner"], sensitive: true })
    expect(aal1).toEqual(expect.objectContaining({ ok: false, code: "mfa_required" }))

    const aal2 = await authorizeStaff(authClient({ user: {
      id: "00000000-0000-4000-8000-000000000001",
      app_metadata: { role: "owner" },
    }, aal: "aal2" }) as never, { allowedRoles: ["owner"], sensitive: true })
    expect(aal2).toEqual(expect.objectContaining({ ok: true, assuranceLevel: "aal2" }))
  })

  it("falla cerrado ante un error real de la configuración de seguridad", async () => {
    settings({ data: null, error: { code: "PGRST205", message: "table missing" } })
    const result = await authorizeStaff(authClient({}) as never, { allowedRoles: ["owner"] })
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 503, code: "authz_unavailable" }))
  })
})
