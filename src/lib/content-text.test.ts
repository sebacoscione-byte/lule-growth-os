import { truncateForImagePlate } from "./content-text"

describe("truncateForImagePlate", () => {
  it("deja el texto sin cambios si ya entra en el limite", () => {
    expect(truncateForImagePlate("Texto corto.", 120)).toBe("Texto corto.")
  })

  it("no corta a mitad de palabra ni de oracion cuando la primera oracion entra en el limite", () => {
    const text = "No hace falta esperar a sentir una molestia para venir al consultorio. Un control de rutina a tiempo marca la diferencia."
    expect(truncateForImagePlate(text, 120)).toBe(
      "No hace falta esperar a sentir una molestia para venir al consultorio."
    )
  })

  it("deja pasar completo un texto de una sola oracion si entra en el limite", () => {
    const text = "Los miercoles atiendo en el Hospital Britanico, con todo el respaldo institucional para tu seguimiento."
    expect(truncateForImagePlate(text, 120)).toBe(text)
  })

  it("corta en el ultimo espacio (nunca a mitad de palabra) si ni la primera oracion entra", () => {
    const text = "Una oracion muy larga sin ningun punto intermedio que de casualidad no entra completa en el limite elegido para esta prueba puntual"
    const result = truncateForImagePlate(text, 40)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(text.startsWith(result)).toBe(true)
    expect(result.endsWith(" ")).toBe(false)
    // no debe cortar en medio de una palabra: el siguiente caracter en el original tiene que ser un espacio
    expect(text[result.length]).toBe(" ")
  })

  it("usa el limite default de 120 caracteres", () => {
    const text = "a".repeat(150)
    expect(truncateForImagePlate(text).length).toBeLessThanOrEqual(120)
  })
})
