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
    from: jest.fn(() => ({
      insert: insertSpy,
      select: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: [], error: null }) })),
    })),
  }
  ;(createClient as jest.Mock).mockResolvedValue(fakeClient)
  return { insertSpy, from: fakeClient.from }
}

const VALID_EXPERIMENT = {
  name: "Test",
  channel: "instagram",
  hypothesis: "Hipótesis",
  content_or_action: "Acción",
  start_date: "2026-01-01",
  metric_to_improve: "Leads",
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
})

describe("GET /api/experiments", () => {
  it("falla cerrado sin consultar la base y conserva la lectura sin MFA", async () => {
    const { from } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      code: "forbidden",
      error: "Sin permisos",
    })

    const res = await GET()

    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
    })
  })
})

describe("POST /api/experiments", () => {
  it("exige MFA y falla cerrado antes de insertar", async () => {
    const { insertSpy } = mockClient(null, { data: null, error: null })
    ;(authorizeStaff as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      error: "Unauthorized",
    })
    const req = new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify(VALID_EXPERIMENT) })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(insertSpy).not.toHaveBeenCalled()
    expect(authorizeStaff).toHaveBeenCalledWith(expect.anything(), {
      allowedRoles: ["owner", "doctor"],
      sensitive: true,
    })
  })

  it("crea un experimento válido", async () => {
    const { insertSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/experiments", { method: "POST", body: JSON.stringify(VALID_EXPERIMENT) })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const [inserted] = insertSpy.mock.calls[0][0]
    expect(inserted.name).toBe("Test")
  })

  it("SEC-01: rechaza con 400 un channel fuera del check constraint real", async () => {
    const { insertSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/experiments", {
      method: "POST",
      body: JSON.stringify({ ...VALID_EXPERIMENT, channel: "canal_inventado" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("SEC-01: no permite inyectar id/created_at por el body (mass assignment)", async () => {
    const { insertSpy } = mockClient({ id: "u1" }, { data: { id: "1" }, error: null })
    const req = new Request("http://localhost/api/experiments", {
      method: "POST",
      body: JSON.stringify({ ...VALID_EXPERIMENT, id: "id-hackeado", created_at: "2020-01-01" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const [inserted] = insertSpy.mock.calls[0][0]
    expect(inserted.id).toBeUndefined()
    expect(inserted.created_at).toBeUndefined()
  })
})
