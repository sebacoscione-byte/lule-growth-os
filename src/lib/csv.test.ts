import { neutralizeCsvFormula, escapeCsvCell } from "./csv"

describe("neutralizeCsvFormula", () => {
  it("antepone comilla a una fórmula con =", () => {
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil.com","click")')).toBe(
      `'=HYPERLINK("http://evil.com","click")`
    )
  })

  it("antepone comilla a un ataque DDE clásico con +", () => {
    expect(neutralizeCsvFormula("+cmd|'/c calc'!A1")).toBe("'+cmd|'/c calc'!A1")
  })

  it("antepone comilla a un ataque DDE clásico con -", () => {
    expect(neutralizeCsvFormula("-2+3+cmd|'/c calc'!A1")).toBe("'-2+3+cmd|'/c calc'!A1")
  })

  it("antepone comilla a una celda que empieza con @", () => {
    expect(neutralizeCsvFormula("@SUM(1+1)")).toBe("'@SUM(1+1)")
  })

  it("antepone comilla a una celda que empieza con tab", () => {
    expect(neutralizeCsvFormula("\t=1+1")).toBe("'\t=1+1")
  })

  it("antepone comilla a una celda que empieza con retorno de carro", () => {
    expect(neutralizeCsvFormula("\r=1+1")).toBe("'\r=1+1")
  })

  it("no toca texto normal, aunque contenga esos caracteres en el medio", () => {
    expect(neutralizeCsvFormula("María José - turno confirmado")).toBe("María José - turno confirmado")
  })

  it("no toca texto normal sin caracteres riesgosos", () => {
    expect(neutralizeCsvFormula("Consulta cardiológica")).toBe("Consulta cardiológica")
  })
})

describe("escapeCsvCell", () => {
  it("devuelve string vacío para null/undefined", () => {
    expect(escapeCsvCell(null)).toBe("")
    expect(escapeCsvCell(undefined)).toBe("")
  })

  it("neutraliza y comilla una fórmula maliciosa que además tiene una coma", () => {
    expect(escapeCsvCell("=HYPERLINK(\"http://evil.com\"),click")).toBe(
      `"'=HYPERLINK(""http://evil.com""),click"`
    )
  })

  it("comilla un valor con coma sin fórmula", () => {
    expect(escapeCsvCell("Lanús, Buenos Aires")).toBe(`"Lanús, Buenos Aires"`)
  })

  it("comilla y escapa comillas internas", () => {
    expect(escapeCsvCell('Dijo "hola"')).toBe(`"Dijo ""hola"""`)
  })

  it("deja pasar texto normal sin comillas", () => {
    expect(escapeCsvCell("OSDE")).toBe("OSDE")
  })

  it("neutraliza una fórmula simple sin otros caracteres especiales", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1")
  })
})
