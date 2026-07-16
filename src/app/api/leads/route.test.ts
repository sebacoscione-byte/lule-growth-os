jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))

import { GET, POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"

function mockClient(user: { id: string } | null, insertResult: { data: unknown; error: { message: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- el parámetro solo tipa el mock para poder leer insertSpy.mock.calls
  const insertSpy = jest.fn((_rows: Array<Record<string, unknown>>) => ({
    select: jest.fn(() => ({
      single: jest.fn().mockResolvedValue(insertResult),
    })),
  }))
  const fakeClient = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({ insert: insertSpy })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(fakeClient)
  return { insertSpy, from: fakeClient.from }
}

describe("GET/POST /api/leads", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
  })

  it("falla cerrado antes de consultar datos para un GET rechazado", async () => {
    const { from } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "mfa_required",
      error: "MFA requerido",
    })

    const res = await GET(new Request("http://localhost/api/leads"))

    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor", "reception"],
      sensitive: true,
    })
  })

  it("devuelve 401 sin sesión antes de insertar", async () => {
    const { insertSpy } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      error: "Unauthorized",
    })
    const req = new Request("http://localhost/api/leads", { method: "POST", body: JSON.stringify({ name: "Test" }) })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("crea un lead con los defaults esperados cuando el body viene vacío", async () => {
    const { insertSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/leads", { method: "POST", body: JSON.stringify({}) })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const [inserted] = insertSpy.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(inserted.origin_channel).toBe("manual")
    expect(inserted.requested_service).toBe("no_definido")
    expect(inserted.status).toBe("nuevo")
  })

  it("SEC-01: rechaza con 400 un requested_service fuera del enum real", async () => {
    const { insertSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/leads", {
      method: "POST",
      body: JSON.stringify({ requested_service: "servicio_inventado" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("SEC-01: rechaza con 400 un JSON inválido", async () => {
    mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/leads", { method: "POST", body: "esto no es json" })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("SEC-01: rechaza con 400 un name que excede el largo máximo", async () => {
    mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/leads", {
      method: "POST",
      body: JSON.stringify({ name: "a".repeat(500) }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
