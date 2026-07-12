import { POST } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
import { createClient } from "@/lib/supabase/server"

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
  return { insertSpy }
}

describe("POST /api/leads", () => {
  it("devuelve 401 sin sesión", async () => {
    mockClient(null, { data: null, error: null })
    const req = new Request("http://localhost/api/leads", { method: "POST", body: JSON.stringify({ name: "Test" }) })
    const res = await POST(req)
    expect(res.status).toBe(401)
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
