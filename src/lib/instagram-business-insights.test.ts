import { parseInstagramInsightValue } from "@/lib/instagram-business"

describe("Instagram insights", () => {
  it("toma el valor diario mas reciente", () => {
    expect(parseInstagramInsightValue({
      data: [{ values: [{ value: 3 }, { value: 8 }] }],
    })).toBe(8)
  })

  it("acepta respuestas agregadas", () => {
    expect(parseInstagramInsightValue({
      data: [{ total_value: { value: 21 } }],
    })).toBe(21)
  })

  it("distingue una metrica sin datos de un cero real", () => {
    expect(parseInstagramInsightValue({ data: [] })).toBeNull()
    expect(parseInstagramInsightValue({ data: [{ values: [{ value: 0 }] }] })).toBe(0)
  })
})
