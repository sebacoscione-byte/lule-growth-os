import { NextRequest } from "next/server"
import { GET } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/google-business", () => ({
  saveTokens: jest.fn(),
  listAccounts: jest.fn(),
  listLocations: jest.fn(),
}))

import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { saveTokens, listAccounts } from "@/lib/google-business"
import { GOOGLE_OAUTH_STATE_COOKIE, GOOGLE_OAUTH_VERIFIER_COOKIE } from "@/lib/google-oauth"

const STATE_COOKIE = GOOGLE_OAUTH_STATE_COOKIE
const VERIFIER_COOKIE = GOOGLE_OAUTH_VERIFIER_COOKIE

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
  const url = new URL("http://localhost/api/google-business/callback")
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  return new NextRequest(url.toString(), { headers: cookieHeader ? { cookie: cookieHeader } : {} })
}

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
  ;(getServiceDb as jest.Mock).mockReturnValue(upsertableDb())
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

describe("GET /api/google-business/callback", () => {
  it("redirige a /login sin sesión", async () => {
    mockAuthedUser(null)
    const res = await GET(callbackRequest({ code: "abc" }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("redirige con error=auth_denied si Google no manda code", async () => {
    mockAuthedUser({ id: "u1" })
    const res = await GET(callbackRequest({}))
    expect(res.headers.get("location")).toContain("error=auth_denied")
  })

  it("redirige con error=oauth_state si el state no coincide", async () => {
    mockAuthedUser({ id: "u1" })
    const res = await GET(callbackRequest(
      { code: "abc", state: "state-recibido" },
      { [STATE_COOKIE]: "otro-state", [VERIFIER_COOKIE]: "verifier" }
    ))
    expect(res.headers.get("location")).toContain("error=oauth_state")
  })

  it("OPS-01: loguea y redirige con error=token_exchange si Meta/Google rechaza el intercambio", async () => {
    mockAuthedUser({ id: "u1" })
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve("invalid_grant") }) as never

    const res = await GET(callbackRequest(
      { code: "abc", state: "same-state" },
      { [STATE_COOKIE]: "same-state", [VERIFIER_COOKIE]: "verifier" }
    ))

    expect(res.headers.get("location")).toContain("error=token_exchange")
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("token_exchange"))
    consoleSpy.mockRestore()
  })

  it("redirige con connected=1 y guarda los tokens en un intercambio exitoso", async () => {
    mockAuthedUser({ id: "u1" })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok", refresh_token: "refresh" }),
    }) as never
    ;(listAccounts as jest.Mock).mockResolvedValue({ accounts: [] })

    const res = await GET(callbackRequest(
      { code: "abc", state: "same-state" },
      { [STATE_COOKIE]: "same-state", [VERIFIER_COOKIE]: "verifier" }
    ))

    expect(res.headers.get("location")).toContain("connected=1")
    expect(saveTokens).toHaveBeenCalled()
  })

  it("OPS-01: si falla el descubrimiento de cuenta/ubicación, loguea pero igual redirige con connected=1 (no fatal)", async () => {
    mockAuthedUser({ id: "u1" })
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok", refresh_token: "refresh" }),
    }) as never
    ;(listAccounts as jest.Mock).mockRejectedValue(new Error("Google API caída"))

    const res = await GET(callbackRequest(
      { code: "abc", state: "same-state" },
      { [STATE_COOKIE]: "same-state", [VERIFIER_COOKIE]: "verifier" }
    ))

    expect(res.headers.get("location")).toContain("connected=1")
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("location_discovery"))
    consoleSpy.mockRestore()
  })
})
