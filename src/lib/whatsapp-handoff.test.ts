import { buildHandoffSummary } from "@/lib/whatsapp-handoff"

describe("buildHandoffSummary", () => {
  it("arma un resumen compacto a partir del lead y la conversacion", () => {
    const summary = buildHandoffSummary({
      phone: "5491100000000",
      lead: {
        id: "lead-1",
        name: "Juana Pérez",
        insurance: "OSDE",
        patient_age: 52,
        general_reason: "Dolor precordial ocasional",
        possible_emergency: false,
        protocol_interest: true,
        protocol_name: "Estudio arritmias 2026",
        last_message: "Quiero saber si aplico al protocolo",
      },
      messagesSentCount: 6,
      costEstimatedTotal: 0,
      nextStepHint: "Contactar para evaluar elegibilidad de protocolo",
    })

    expect(summary.nombre).toBe("Juana Pérez")
    expect(summary.cobertura).toBe("OSDE")
    expect(summary.edad).toBe(52)
    expect(summary.urgencia).toBe("No urgente")
    expect(summary.protocolo_posible).toBe("Estudio arritmias 2026")
    expect(summary.mensajes_enviados).toBe(6)
  })

  it("usa valores por defecto cuando todavia no hay lead creado", () => {
    const summary = buildHandoffSummary({
      phone: "5491100000000",
      lead: null,
      messagesSentCount: 1,
      costEstimatedTotal: null,
      nextStepHint: "Contactar apenas se pueda",
    })

    expect(summary.nombre).toBe("Sin nombre")
    expect(summary.cobertura).toBe("No informada")
    expect(summary.urgencia).toBe("No urgente")
    expect(summary.protocolo_posible).toBe("No")
  })
})
