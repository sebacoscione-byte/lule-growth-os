import { isEmergencyMessage } from "@/lib/medical-safety"

describe("isEmergencyMessage", () => {
  it("detecta dolor de pecho", () => {
    expect(isEmergencyMessage("tengo mucho dolor de pecho hace 10 minutos")).toBe(true)
  })

  it("detecta los sintomas nuevos pedidos: debilidad de un lado del cuerpo", () => {
    expect(isEmergencyMessage("se me durmió un lado de la cara")).toBe(true)
  })

  it("detecta dolor en brazo izquierdo con opresion", () => {
    expect(isEmergencyMessage("tengo opresion en el pecho y dolor en el brazo izquierdo")).toBe(true)
  })

  it("detecta palpitaciones intensas con mareo", () => {
    expect(isEmergencyMessage("tengo palpitaciones intensas y mareo")).toBe(true)
  })

  it("detecta presion muy alta con sintomas", () => {
    expect(isEmergencyMessage("tengo la presion muy alta y me siento mal")).toBe(true)
  })

  it("Ola 4 (incidente real 2026-07-14): detecta un mensaje con presión numérica alta y sin ninguna frase fija (mensaje sintético equivalente al real, sin datos identificables)", () => {
    expect(isEmergencyMessage(
      "Un familiar tuvo un pico de presión hoy, quiero que lo vean lo antes posible, tiene la presión en 185"
    )).toBe(true)
  })

  it("detecta un valor numérico de presión alto sin la palabra 'pico'", () => {
    expect(isEmergencyMessage("tiene 180 de presión y no se siente bien")).toBe(true)
    expect(isEmergencyMessage("la presión le dio 190")).toBe(true)
  })

  it("no marca como emergencia un valor de presión normal", () => {
    expect(isEmergencyMessage("la presión le dio 120, está bien")).toBe(false)
    expect(isEmergencyMessage("tiene 130 de presión, normal para su edad")).toBe(false)
  })

  it("no marca como emergencia una consulta normal", () => {
    expect(isEmergencyMessage("hola, queria pedir turno para un ecocardiograma")).toBe(false)
  })

  it("no marca como emergencia una pregunta sobre cobertura", () => {
    expect(isEmergencyMessage("atienden OSDE?")).toBe(false)
  })
})
