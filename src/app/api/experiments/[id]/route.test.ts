import { PATCH } from "./route"

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
import { createClient } from "@/lib/supabase/server"

function mockClient(user: { id: string } | null, updateResult: { data: unknown; error: { message: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- el parámetro solo tipa el mock para poder leer updateSpy.mock.calls
  const updateSpy = jest.fn((_patch: Record<string, unknown>) => ({
    eq: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue(updateResult),
      })),
    })),
  }))
  const fakeClient = {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({ update: updateSpy })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(fakeClient)
  return { updateSpy }
}

describe("PATCH /api/experiments/[id]", () => {
  it("devuelve 401 sin sesión", async () => {
    mockClient(null, { data: null, error: null })
    const req = new Request("http://localhost/api/experiments/1", { method: "PATCH", body: JSON.stringify({ result: "ok" }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })

  it("SEC-01: solo permite actualizar result/winner — no se puede inyectar channel/id por el body", async () => {
    const { updateSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/experiments/1", {
      method: "PATCH",
      body: JSON.stringify({ result: "Funcionó", winner: true, channel: "canal-hackeado", id: "otro-id" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({ result: "Funcionó", winner: true })
  })

  it("SEC-01: rechaza con 400 un winner que no es boolean", async () => {
    mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/experiments/1", {
      method: "PATCH",
      body: JSON.stringify({ winner: "si" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(400)
  })
})
