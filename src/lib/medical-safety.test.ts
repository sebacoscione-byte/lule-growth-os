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

  it("no marca como emergencia una consulta normal", () => {
    expect(isEmergencyMessage("hola, queria pedir turno para un ecocardiograma")).toBe(false)
  })

  it("no marca como emergencia una pregunta sobre cobertura", () => {
    expect(isEmergencyMessage("atienden OSDE?")).toBe(false)
  })
})
