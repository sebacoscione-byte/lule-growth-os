import { GET } from "./route"

const ORIGINAL_ENV = process.env

beforeEach(() => {
  jest.resetModules()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("GET /api/cron/weekly-report — autorización", () => {
  it("fail-closed: rechaza si CRON_SECRET no está configurado, aunque venga un header", async () => {
    delete process.env.CRON_SECRET
    const req = new Request("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer cualquier-cosa" },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("rechaza un secreto incorrecto", async () => {
    process.env.CRON_SECRET = "secreto-real"
    const req = new Request("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer secreto-incorrecto" },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("rechaza si no viene ningún header de autorización", async () => {
    process.env.CRON_SECRET = "secreto-real"
    const req = new Request("http://localhost/api/cron/weekly-report")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
