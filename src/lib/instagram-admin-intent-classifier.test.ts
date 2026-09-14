import {
  classifyInstagramAdministrativeIntent,
  detectInstagramPracticeServices,
  getInstagramAutoReplyBlockReason,
  normalizeInstagramAdministrativeText,
} from "./instagram-admin-intent-classifier"

describe("Instagram administrative intent classifier", () => {
  it.each([
    ["En el británico de Lanús haces solo ecocardio o tmb consulta cardiológica?", "service"],
    ["en el britanico de lanus haces ecocardiogama o consulta?", "service"],
    ["¿En qué sede hacés eco?", "service"],
    ["¿Atienden OSDE?", "coverage"],
    ["Galeno?", "coverage"],
    ["No tengo obra social", "coverage"],
    ["¿Me pasás el wsp del CIMEL?", "contact"],
    ["¿Cuál es el telefno del Británico de Lanús?", "contact"],
    ["¿Necesito autorisacion para el estudio?", "requirements"],
    ["¿Dónde retiro el informe?", "results"],
    ["Necesito reprogramar el turno", "appointment_management"],
    ["¿Cómo confirmo mi turno?", "appointment_management"],
    ["¿Dónde atiende?", "location"],
    ["¿Atendés en Lanús?", "location"],
    ["¿Tenés turnos disponibles esta semana?", "booking"],
    ["¿Qué especialidad tiene la doctora?", "specialty"],
  ] as const)("clasifica variantes reales y errores de tipeo: %s", (message, intent) => {
    expect(classifyInstagramAdministrativeIntent(message)?.intent).toBe(intent)
  })

  it("normaliza abreviaturas de chat sin usar un LLM", () => {
    const normalized = normalizeInstagramAdministrativeText("Tmb x wsp, ecocardio")
    expect(normalized).toContain("tambien")
    expect(normalized).toContain("whatsapp")
    expect(normalized).toContain("ecocardiograma")
  })

  it("detecta ambas prestaciones en la consulta real del Británico de Lanús", () => {
    expect(detectInstagramPracticeServices(
      "En el británico de Lanús haces solo ecocardio o tmb consulta cardiológica?"
    )).toEqual(["echocardiogram", "cardiology_consultation"])
  })

  it.each([
    "Hola",
    "Gracias doctora",
    "Qué linda publicación",
    "Es un caso muy particular",
    "Swiss Medical",
    "Tengo turno mañana",
  ])("no fuerza una intención cuando falta contexto suficiente: %s", message => {
    expect(classifyInstagramAdministrativeIntent(message)).toBeNull()
  })

  it.each([
    ["Es urgente, quiero un turno", "urgency"],
    ["¿Podés interpretar mi ecocardiograma?", "clinical_interpretation"],
    ["¿Cuánto cuesta la consulta?", "price"],
    ["Ya tengo turno, gracias", "already_resolved"],
    ["No quiero turno", "explicit_rejection"],
  ] as const)("bloquea casos que no deben disparar una respuesta automática: %s", (message, reason) => {
    expect(getInstagramAutoReplyBlockReason(message)).toBe(reason)
  })
})
