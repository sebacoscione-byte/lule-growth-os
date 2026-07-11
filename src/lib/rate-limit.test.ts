import { getClientIp } from "./rate-limit"

describe("getClientIp", () => {
  it("toma la primera IP de x-forwarded-for cuando hay varias (proxies encadenados)", () => {
    const req = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })
    expect(getClientIp(req)).toBe("1.2.3.4")
  })

  it("recorta espacios alrededor de la IP", () => {
    const req = new Request("http://localhost", { headers: { "x-forwarded-for": "  1.2.3.4  " } })
    expect(getClientIp(req)).toBe("1.2.3.4")
  })

  it("devuelve 'unknown' si no viene el header", () => {
    const req = new Request("http://localhost")
    expect(getClientIp(req)).toBe("unknown")
  })
})
