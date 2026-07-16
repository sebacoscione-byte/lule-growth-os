import { NextRequest } from "next/server"
import { GET } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/instagram-business", () => ({
  exchangeCodeForToken: jest.fn(),
  exchangeForLongLivedToken: jest.fn(),
  getProfile: jest.fn(),
  saveTokens: jest.fn(),
}))

import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { exchangeCodeForToken, exchangeForLongLivedToken, getProfile, saveTokens } from "@/lib/instagram-business"
import { INSTAGRAM_OAUTH_STATE_COOKIE } from "@/lib/instagram-oauth"

function mockAuthedUser(user: { id: string } | null) {
  ;(createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
  })
}

function upsertableDb() {
  return {
    from: jest.fn(() => ({
      upsert: jest.fn().mockResolvedValue({ error: null }),
    })),
  }
}

function callbackRequest(params: Record<string, string>, cookies: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/instagram-business/callback")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  return new NextRequest(url.toString(), { headers: cookieHeader ? { cookie: cookieHeader } : {} })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authorizeStaff as jest.Mock).mockResolvedValue({
    ok: true,
    user: { id: "u1" },
    role: "owner",
    legacyCompatibility: false,
    assuranceLevel: "aal2",
  })
  ;(getServiceDb as jest.Mock).mockReturnValue(upsertableDb())
})

describe("GET /api/instagram-business/callback", () => {
  it("redirige a /login sin sesión", async () => {
    mockAuthedUser(null)
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      error: "Unauthorized",
    })
    const res = await GET(callbackRequest({ code: "abc" }))
    expect(res.headers.get("location")).toContain("/login")
  })

  it("redirige con ig_error=auth_denied si Meta no manda code", async () => {
    mockAuthedUser({ id: "u1" })
    const res = await GET(callbackRequest({}))
    expect(res.headers.get("location")).toContain("ig_error=auth_denied")
  })

  it("redirige con ig_error=oauth_state si el state no coincide", async () => {
    mockAuthedUser({ id: "u1" })
    const res = await GET(callbackRequest(
      { code: "abc", state: "state-recibido" },
      { [INSTAGRAM_OAUTH_STATE_COOKIE]: "otro-state" }
    ))
    expect(res.headers.get("location")).toContain("ig_error=oauth_state")
  })

  it("OPS-01: loguea y redirige con ig_error=token_exchange si falla el intercambio", async () => {
    mockAuthedUser({ id: "u1" })
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    ;(exchangeCodeForToken as jest.Mock).mockRejectedValue(new Error("invalid_grant"))

    const res = await GET(callbackRequest(
      { code: "abc", state: "same-state" },
      { [INSTAGRAM_OAUTH_STATE_COOKIE]: "same-state" }
    ))

    expect(res.headers.get("location")).toContain("ig_error=token_exchange")
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("token_exchange"))
    consoleSpy.mockRestore()
  })

  it("redirige con ig_connected=1 y guarda los tokens en un intercambio exitoso", async () => {
    mockAuthedUser({ id: "u1" })
    ;(exchangeCodeForToken as jest.Mock).mockResolvedValue({ access_token: "short", user_id: "123" })
    ;(exchangeForLongLivedToken as jest.Mock).mockResolvedValue({ access_token: "long", expires_in: 5184000 })
    ;(getProfile as jest.Mock).mockResolvedValue({ username: "draluciachahin" })

    const res = await GET(callbackRequest(
      { code: "abc", state: "same-state" },
      { [INSTAGRAM_OAUTH_STATE_COOKIE]: "same-state" }
    ))

    expect(res.headers.get("location")).toContain("ig_connected=1")
    expect(saveTokens).toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner"],
      sensitive: true,
    })
  })

  it("rechaza de forma sanitizada a un rol sin permiso antes de intercambiar tokens", async () => {
    mockAuthedUser({ id: "u-doctor" })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      error: "No tenés permisos para esta acción",
    })

    const res = await GET(callbackRequest({ code: "abc" }))

    expect(res.headers.get("location")).toContain("ig_error=forbidden")
    expect(exchangeCodeForToken).not.toHaveBeenCalled()
  })
})
