import { extractIntake, classifyIntentDeterministic, classifyIntent } from "@/lib/whatsapp-intents"

describe("extractIntake", () => {
  it("extrae motivo, obra social, edad, sede y notas del mensaje combinado", () => {
    const result = extractIntake(
      "Quiero un turno, tengo OSDE, tengo 45 años, prefiero CIMEL Lanús, tengo dolor en el pecho a veces",
      ["OSDE", "Swiss Medical", "Galeno"]
    )
    expect(result.motivo).toBe("turno")
    expect(result.obraSocial).toBe("OSDE")
    expect(result.edad).toBe(45)
    expect(result.sede).toBe("cimel_lanus")
    expect(result.notas).toContain("dolor en el pecho")
  })

  it("detecta paciente sin cobertura", () => {
    const result = extractIntake("Quiero un turno, no tengo obra social, tengo 30 años", [])
    expect(result.obraSocial).toBe("Particular / sin cobertura")
  })

  it("detecta interes en protocolo de investigacion", () => {
    const result = extractIntake("Me interesa el protocolo de investigación de arritmias", [])
    expect(result.motivo).toBe("protocolo")
  })

  it("no inventa una edad si no hay ningun numero de edad en el texto", () => {
    const result = extractIntake("Quiero un turno con Galeno", ["Galeno"])
    expect(result.edad).toBeNull()
    expect(result.obraSocial).toBe("Galeno")
  })
})

describe("classifyIntentDeterministic", () => {
  it("clasifica urgencia medica antes que cualquier otra regla", () => {
    expect(classifyIntentDeterministic("tengo mucho dolor de pecho y no puedo respirar")).toBe("urgencia_medica")
  })

  it("clasifica pedido de cancelar/reprogramar turno", () => {
    expect(classifyIntentDeterministic("necesito cancelar mi turno de mañana")).toBe("cancelar_reprogramar")
  })

  it("clasifica pedido de hablar con un humano", () => {
    expect(classifyIntentDeterministic("quiero hablar con una persona del consultorio")).toBe("hablar_con_humano")
  })

  it("clasifica consulta de cobertura", () => {
    expect(classifyIntentDeterministic("aceptan OSDE o tienen convenio con alguna prepaga?")).toBe("consultar_cobertura")
  })

  it("devuelve null cuando no hay ninguna regla que matchee", () => {
    expect(classifyIntentDeterministic("che como andas")).toBeNull()
  })
})

describe("classifyIntent", () => {
  it("con proveedor sin_ia y sin match deterministico devuelve otro_no_entendido sin llamar IA", async () => {
    const result = await classifyIntent("che como andas", "sin_ia")
    expect(result).toBe("otro_no_entendido")
  })

  it("con un proveedor no implementado (openai) degrada a otro_no_entendido sin romper", async () => {
    const result = await classifyIntent("che como andas", "openai")
    expect(result).toBe("otro_no_entendido")
  })

  it("una regla deterministica gana incluso si el proveedor es no implementado", async () => {
    const result = await classifyIntent("tengo dolor de pecho", "meta_business_agent")
    expect(result).toBe("urgencia_medica")
  })
})
