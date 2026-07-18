import {
  buildCoverageLocationsReply,
  buildCoverageNotice,
  isCoverageListedAtLocation,
} from "@/lib/whatsapp-bot"

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

  it("consulta Particular en todas las sedes sin depender de la cobertura guardada", () => {
    const reply = buildCoverageLocationsReply("¿Dónde puedo atenderme particular?", [
      { ...cimel, id: "cimel_lanus", day: "martes" } as never,
      { ...britanico, id: "hospital_britanico", day: "miércoles" } as never,
      { name: "Swiss Medical Lomas", obras_sociales: ["Swiss Medical"], id: "swiss_lomas" } as never,
    ])
    expect(reply).toContain("*Particular*")
    expect(reply).toContain("*CIMEL Lanús*")
    expect(reply).toContain("*Hospital Británico*")
    expect(reply).not.toContain("Swiss Medical Lomas")
  })

  it("consulta Medife y responde sólo las sedes que la tienen verificada", () => {
    const reply = buildCoverageLocationsReply("La doctora atiende Medife?", [
      { ...cimel, id: "cimel_lanus" } as never,
      { ...britanico, id: "hospital_britanico" } as never,
    ])
    expect(reply).toContain("*Medife*")
    expect(reply).toContain("*CIMEL Lanús*")
    expect(reply).not.toContain("Hospital Británico")
  })

  it("informa cuando una cobertura consultada no figura", () => {
    expect(buildCoverageLocationsReply("¿Dónde aceptan PAMI?", [
      { ...cimel, id: "cimel_lanus" } as never,
    ])).toContain("no figura en ninguna")
  })
})
