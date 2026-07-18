import { extractIntake, classifyIntentDeterministic, classifyIntent, classifyProtocolButtonReply, isMarketingOptOutMessage } from "@/lib/whatsapp-intents"

describe("extractIntake", () => {
  const verifiedLocations = [
    {
      id: "cimel_lanus" as const,
      name: "CIMEL Lanús",
      day: "martes",
      obras_sociales: [],
      accepts_particular: true,
      services: [],
      active: true,
    },
    {
      id: "hospital_britanico" as const,
      name: "Hospital Británico",
      day: "miércoles",
      obras_sociales: [],
      accepts_particular: true,
      services: [],
      active: true,
    },
  ]

  it("extrae solamente entidades administrativas del mensaje combinado", () => {
    const result = extractIntake(
      "Quiero un turno, tengo OSDE, tengo 45 años, prefiero CIMEL Lanús, tengo dolor en el pecho a veces",
      ["OSDE", "Swiss Medical", "Galeno"],
      verifiedLocations
    )
    expect(result.motivo).toBe("turno")
    expect(result.obraSocial).toBe("OSDE")
    expect(result.sede).toBe("cimel_lanus")
    expect(result).not.toHaveProperty("edad")
    expect(result).not.toHaveProperty("notas")
  })

  it("detecta la sede Hospital Británico por nombre o día", () => {
    expect(extractIntake("prefiero el británico", [], verifiedLocations).sede).toBe("hospital_britanico")
    expect(extractIntake("¿atiende los miércoles?", [], verifiedLocations).sede).toBe("hospital_britanico")
  })

  it("no infiere una sede por días hardcodeados fuera de la configuración vigente", () => {
    const locationsWithoutTuesday = verifiedLocations.map(location => ({
      ...location,
      day: location.id === "cimel_lanus" ? "jueves" : location.day,
    }))
    expect(extractIntake("¿atiende los martes?", [], locationsWithoutTuesday).sede).toBeNull()
  })

  it("detecta paciente sin cobertura", () => {
    const result = extractIntake("Quiero un turno, no tengo obra social, tengo 30 años", [])
    expect(result.obraSocial).toBe("Particular / sin cobertura")
  })

  it("detecta interes en protocolo de investigacion", () => {
    const result = extractIntake("Me interesa el protocolo de investigación de arritmias", [])
    expect(result.motivo).toBe("protocolo")
  })

  it("no extrae edad aunque el mensaje la incluya", () => {
    const result = extractIntake("Quiero un turno con Galeno, tengo 52 años", ["Galeno"])
    expect(result).not.toHaveProperty("edad")
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

  it("Ola 4 (incidente real 2026-07-14, David Portas): reconoce variantes que no dicen 'hablar con'", () => {
    expect(classifyIntentDeterministic("Prefiero una persona del equipo porfavor")).toBe("hablar_con_humano")
    expect(classifyIntentDeterministic("Prefiero una persona del equipo")).toBe("hablar_con_humano")
    expect(classifyIntentDeterministic("Persona")).toBe("hablar_con_humano")
    expect(classifyIntentDeterministic("necesito hablar con alguien del equipo")).toBe("hablar_con_humano")
  })

  it("no confunde un pedido de turno normal con querer hablar con un humano", () => {
    expect(classifyIntentDeterministic("quiero un turno con la doctora")).not.toBe("hablar_con_humano")
    expect(classifyIntentDeterministic("necesito saber los horarios")).not.toBe("hablar_con_humano")
  })

  it("Ola 4 (incidente real 2026-07-14): reconoce que el paciente ya consiguió turno en otro lado y cierra", () => {
    expect(classifyIntentDeterministic("Hola, gracias doc la tomare en cuenta para la proxima, ya consegui turno en otro lado")).toBe("turno_ya_resuelto")
    expect(classifyIntentDeterministic("ya tengo turno, gracias igual")).toBe("turno_ya_resuelto")
    expect(classifyIntentDeterministic("ya me atendí en otro lado, gracias")).toBe("turno_ya_resuelto")
  })

  it("no confunde un pedido de turno nuevo con uno ya resuelto", () => {
    expect(classifyIntentDeterministic("quiero sacar un turno")).toBe("pedir_turno")
    expect(classifyIntentDeterministic("necesito un turno para la semana que viene")).toBe("pedir_turno")
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

describe("classifyProtocolButtonReply", () => {
  it("reconoce el boton de opt-out del template invitacion_protocolo", () => {
    expect(classifyProtocolButtonReply("No, gracias")).toBe("opt_out")
  })

  it("reconoce el boton de opt-in del template invitacion_protocolo", () => {
    expect(classifyProtocolButtonReply("Sí, quiero más información")).toBe("opt_in")
  })

  it("no confunde un mensaje de texto libre parecido con el boton", () => {
    expect(classifyProtocolButtonReply("no gracias, no me interesa por ahora")).toBeNull()
  })
})

describe("isMarketingOptOutMessage (DATA-02)", () => {
  it("reconoce la palabra clave BAJA", () => {
    expect(isMarketingOptOutMessage("BAJA")).toBe(true)
    expect(isMarketingOptOutMessage("quiero la baja")).toBe(true)
    expect(isMarketingOptOutMessage("quiero darme de baja")).toBe(true)
  })

  it("no confunde la palabra baja dentro de una consulta clínica", () => {
    expect(isMarketingOptOutMessage("Me baja la presión cuando me levanto")).toBe(false)
    expect(isMarketingOptOutMessage("Tengo la presión baja")).toBe(false)
  })

  it("reconoce STOP", () => {
    expect(isMarketingOptOutMessage("STOP")).toBe(true)
  })

  it("reconoce frases explicitas de no contactar mas", () => {
    expect(isMarketingOptOutMessage("no me escriban mas por favor")).toBe(true)
    expect(isMarketingOptOutMessage("no quiero mas mensajes")).toBe(true)
    expect(isMarketingOptOutMessage("dejen de contactarme")).toBe(true)
  })

  it("no confunde un mensaje normal de cancelar/reprogramar turno con un opt-out de marketing", () => {
    expect(isMarketingOptOutMessage("necesito cancelar mi turno de mañana")).toBe(false)
    expect(isMarketingOptOutMessage("no puedo ir a mi turno")).toBe(false)
  })

  it("no confunde una consulta normal con un opt-out", () => {
    expect(isMarketingOptOutMessage("quiero un turno con la doctora")).toBe(false)
  })
})
