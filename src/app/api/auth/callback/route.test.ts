import { GET } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))

import { createClient } from "@/lib/supabase/server"

function authClient({
  exchangeError = null,
  aalError = null,
  currentLevel = "aal1",
  nextLevel = "aal1",
}: {
  exchangeError?: { code: string } | null
  aalError?: { code: string } | null
  currentLevel?: string | null
  nextLevel?: string | null
} = {}) {
  return {
    auth: {
      exchangeCodeForSession: jest.fn().mockResolvedValue({ data: {}, error: exchangeError }),
      mfa: {
        getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
          data: aalError ? null : { currentLevel, nextLevel, currentAuthenticationMethods: [] },
          error: aalError,
        }),
      },
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  }
}

function request(query = "") {
  return new Request(`https://draluciachahin.ar/api/auth/callback${query}`)
}

beforeEach(() => jest.clearAllMocks())

describe("GET /api/auth/callback", () => {
  it("falla cerrado si falta el código o el intercambio es rechazado", async () => {
    const client = authClient({ exchangeError: { code: "invalid_grant" } })
    ;(createClient as jest.Mock).mockResolvedValue(client)

    const missing = await GET(request())
    const rejected = await GET(request("?code=bad"))

    expect(missing.headers.get("location")).toBe("https://draluciachahin.ar/login?error=auth_callback")
    expect(rejected.headers.get("location")).toBe("https://draluciachahin.ar/login?error=auth_callback")
  })

  it("rechaza destinos externos y redirige a una ruta interna segura", async () => {
    ;(createClient as jest.Mock).mockResolvedValue(authClient())

    const response = await GET(request("?code=ok&next=%2F%2Fevil.example"))

    expect(response.headers.get("location")).toBe("https://draluciachahin.ar/dashboard")
  })

  it("no confía en un Host externo para construir la redirección", async () => {
    ;(createClient as jest.Mock).mockResolvedValue(authClient())

    const response = await GET(new Request("https://evil.example/api/auth/callback?code=ok"))

    expect(response.headers.get("location")).toBe("https://draluciachahin.ar/dashboard")
  })

  it("envía a challenge cuando la cuenta tiene un factor verificado", async () => {
    ;(createClient as jest.Mock).mockResolvedValue(authClient({ currentLevel: "aal1", nextLevel: "aal2" }))

    const response = await GET(request("?code=ok&next=%2Fleads%3Fstatus%3Dnew"))
    const location = new URL(response.headers.get("location")!)

    expect(location.pathname).toBe("/seguridad/mfa")
    expect(location.searchParams.get("next")).toBe("/leads?status=new")
  })

  it("cierra la sesión si no puede determinar el nivel de seguridad", async () => {
    const client = authClient({ aalError: { code: "provider_unavailable" } })
    ;(createClient as jest.Mock).mockResolvedValue(client)

    const response = await GET(request("?code=ok"))

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(response.headers.get("location")).toContain("error=security_check")
  })
})
