import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(
  resolve(process.cwd(), "src/app/(app)/inbox/page.tsx"),
  "utf8"
)

describe("Inbox mobile conversation header", () => {
  it("apila identidad y acciones en celular y recupera la fila horizontal en desktop", () => {
    expect(source).toContain("flex flex-col gap-2 md:flex-row md:items-center")
    expect(source).toContain("grid grid-cols-2 gap-2 w-full md:flex")
  })

  it("permite que los textos largos de las acciones ocupen mas de una linea", () => {
    expect(source).toContain("min-h-9 h-auto whitespace-normal leading-tight")
  })

  it("distingue espera, conversacion tomada y nueva respuesta del paciente", () => {
    expect(source).toContain("Esperando a una persona")
    expect(source).toContain("Conversación tomada")
    expect(source).toContain("Paciente respondió")
  })
})
