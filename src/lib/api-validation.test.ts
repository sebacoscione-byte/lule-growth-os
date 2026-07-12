import { z } from "zod"
import { parseJsonBody, formatZodError } from "./api-validation"

describe("parseJsonBody", () => {
  it("devuelve ok:true con el body parseado si es JSON válido", async () => {
    const request = new Request("http://localhost", { method: "POST", body: JSON.stringify({ a: 1 }) })
    const result = await parseJsonBody(request)
    expect(result).toEqual({ ok: true, data: { a: 1 } })
  })

  it("devuelve ok:false si el body no es JSON válido", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "esto no es json" })
    const result = await parseJsonBody(request)
    expect(result.ok).toBe(false)
  })

  it("devuelve ok:false si el body está vacío", async () => {
    const request = new Request("http://localhost", { method: "POST" })
    const result = await parseJsonBody(request)
    expect(result.ok).toBe(false)
  })
})

describe("formatZodError", () => {
  const schema = z.object({ phone: z.string().min(1), age: z.number() })

  it("incluye el campo y el mensaje del primer error", () => {
    const result = schema.safeParse({ phone: "", age: "no es numero" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(formatZodError(result.error)).toContain("phone")
    }
  })

  it("no rompe si por algún motivo no hay issues", () => {
    const error = new z.ZodError([])
    expect(formatZodError(error)).toBe("Datos inválidos")
  })
})
