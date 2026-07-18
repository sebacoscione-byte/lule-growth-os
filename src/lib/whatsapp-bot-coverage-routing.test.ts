import { buildCoverageNotice, isCoverageListedAtLocation } from "@/lib/whatsapp-bot"

describe("cobertura por sede del bot de WhatsApp", () => {
  const cimel = {
    name: "CIMEL Lanús",
    obras_sociales: ["Medife", "Osmecon", "Particular"],
  }
  const britanico = {
    name: "Hospital Británico",
    obras_sociales: ["Avalian", "Galeno", "Osde", "Particular"],
  }

  it("no presenta OSDE como verificada en una sede que no la tiene cargada", () => {
    expect(buildCoverageNotice(cimel, "OSDE 410")).toContain("no figura")
    expect(buildCoverageNotice(cimel, "OSDE 410")).toContain("Confirmala directamente")
  })

  it("reconoce un plan de una cobertura base verificada sin prometer autorización", () => {
    expect(buildCoverageNotice(britanico, "OSDE 410")).toBe(
      "La cobertura *OSDE 410* figura en la lista verificada de *Hospital Británico*."
    )
  })

  it("informa particular sólo cuando la sede lo tiene verificado", () => {
    expect(buildCoverageNotice(cimel, "Particular / sin cobertura")).toContain("figura")
    expect(buildCoverageNotice({ name: "Sede", obras_sociales: ["Medife"] }, "Particular / sin cobertura"))
      .toContain("no figura")
  })

  it("no agrega aviso si el paciente todavía no informó cobertura", () => {
    expect(buildCoverageNotice(cimel, null)).toBeNull()
  })

  it("expone una decisión reutilizable para impedir derivaciones incompatibles", () => {
    expect(isCoverageListedAtLocation(cimel, "OSDE 410")).toBe(false)
    expect(isCoverageListedAtLocation(britanico, "OSDE 410")).toBe(true)
    expect(isCoverageListedAtLocation(cimel, null)).toBeNull()
  })
})
