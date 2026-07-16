jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))

import { DELETE, PATCH } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"

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
  return { updateSpy, from: fakeClient.from }
}

describe("PATCH /api/experiments/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
  })

  it("falla cerrado antes de actualizar", async () => {
    const { updateSpy } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      error: "Unauthorized",
    })
    const req = new Request("http://localhost/api/experiments/1", { method: "PATCH", body: JSON.stringify({ result: "ok" }) })
    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
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

describe("DELETE /api/experiments/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
  })

  it("falla cerrado antes de borrar", async () => {
    const { from } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "mfa_required",
      error: "MFA requerido",
    })

    const res = await DELETE(new Request("http://localhost/api/experiments/1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "1" }),
    })

    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
  })
})
