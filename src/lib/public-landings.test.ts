import { resolvesToBotNumber, WHATSAPP_NUMBER } from "./public-landings"

describe("resolvesToBotNumber (GROWTH-01)", () => {
  it("es true sin rawNumber (usa el número del bot por default)", () => {
    expect(resolvesToBotNumber(undefined)).toBe(true)
  })

  it("es false si la sede tiene un WhatsApp propio distinto (ej. Swity de Swiss Medical)", () => {
    expect(resolvesToBotNumber("11 5051-9982")).toBe(false)
  })

  it("es true si el override normalizado coincide con el número del bot", () => {
    // WHATSAPP_NUMBER ya viene con 549 al frente -- probamos con el mismo número en formato local.
    const local = WHATSAPP_NUMBER.replace(/^549/, "")
    expect(resolvesToBotNumber(local)).toBe(true)
  })
})
