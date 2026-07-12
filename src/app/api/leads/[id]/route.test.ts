import { GET, PATCH } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
import { createClient } from "@/lib/supabase/server"

type QueryResult = { data: unknown; error: { message: string } | null }

function mockClient(user: { id: string } | null, queryResult: QueryResult) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- el parámetro solo tipa el mock para poder leer updateSpy.mock.calls
  const updateSpy = jest.fn((_patch: Record<string, unknown>) => ({
    eq: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue(queryResult),
      })),
    })),
  }))
  const selectSpy = jest.fn(() => ({
    eq: jest.fn(() => ({
      single: jest.fn().mockResolvedValue(queryResult),
    })),
  }))
  const fromSpy = jest.fn(() => ({ select: selectSpy, update: updateSpy }))
  const fakeClient = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: fromSpy,
  }
  ;(createClient as jest.Mock).mockResolvedValue(fakeClient)
  return { updateSpy, fromSpy }
}

describe("GET /api/leads/[id]", () => {
  it("devuelve 401 sin sesión", async () => {
    mockClient(null, { data: null, error: null })
    const res = await GET(new Request("http://localhost/api/leads/abc"), { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(401)
  })

  it("devuelve el lead con sesión válida", async () => {
    mockClient({ id: "user-1" }, { data: { id: "abc", name: "Test" }, error: null })
    const res = await GET(new Request("http://localhost/api/leads/abc"), { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe("Test")
  })

  it("devuelve 404 si Supabase no encuentra el lead", async () => {
    mockClient({ id: "user-1" }, { data: null, error: { message: "not found" } })
    const res = await GET(new Request("http://localhost/api/leads/abc"), { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(404)
  })
})

describe("PATCH /api/leads/[id]", () => {
  it("devuelve 401 sin sesión", async () => {
    mockClient(null, { data: null, error: null })
    const req = new Request("http://localhost/api/leads/abc", { method: "PATCH", body: JSON.stringify({ status: "nuevo" }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(401)
  })

  it("solo actualiza campos de la allowlist — no se puede inyectar id/created_at por el body", async () => {
    const { updateSpy } = mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", {
      method: "PATCH",
      body: JSON.stringify({
        status: "nuevo",
        id: "otro-id-hackeado",
        created_at: "2020-01-01",
        not_a_real_field: "x",
      }),
    })
    await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(updateSpy).toHaveBeenCalledWith({ status: "nuevo" })
  })

  it("auto-completa followup_due_at al pasar a seguimiento_pendiente sin fecha explícita", async () => {
    const { updateSpy } = mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", {
      method: "PATCH",
      body: JSON.stringify({ status: "seguimiento_pendiente" }),
    })
    await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    const patch = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(patch.status).toBe("seguimiento_pendiente")
    expect(patch.followup_due_at).toBeDefined()
  })

  it("no pisa followup_due_at si ya viene explícito en el body", async () => {
    const { updateSpy } = mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", {
      method: "PATCH",
      body: JSON.stringify({ status: "seguimiento_pendiente", followup_due_at: "2030-01-01T00:00:00.000Z" }),
    })
    await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    const patch = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(patch.followup_due_at).toBe("2030-01-01T00:00:00.000Z")
  })

  it("SEC-01: rechaza con 400 un status fuera del enum real", async () => {
    const { updateSpy } = mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", {
      method: "PATCH",
      body: JSON.stringify({ status: "estado_inventado" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(400)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("SEC-01: rechaza con 400 un priority_score fuera de rango", async () => {
    mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", {
      method: "PATCH",
      body: JSON.stringify({ priority_score: 999 }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(400)
  })

  it("SEC-01: rechaza con 400 si el body no es un objeto JSON", async () => {
    mockClient({ id: "user-1" }, { data: { id: "abc" }, error: null })
    const req = new Request("http://localhost/api/leads/abc", { method: "PATCH", body: JSON.stringify(null) })
    const res = await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(400)
  })
})
