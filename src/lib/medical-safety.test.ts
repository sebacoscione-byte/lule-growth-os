import {
  containsSensitiveMedicalContent,
  assessEmergencyMessage,
  isEmergencyMessage,
  isMedicalBoundaryMessage,
  MEDICAL_BOUNDARY_REPLY,
} from "@/lib/medical-safety"

describe("guardrail médico determinístico", () => {
  it.each([
    "tengo mucho dolor de pecho hace 10 minutos",
    "se me durmió un lado de la cara",
    "tengo opresión en el pecho y dolor en el brazo izquierdo",
    "tengo palpitaciones intensas y mareo",
    "se desmayó y no reacciona",
    "de repente no puedo hablar bien",
    "Me duele fuerte el pecho ahora",
    "Me duele en el pecho ahora",
    "Me duele fuerte en el pecho",
    "Siento un dolor insoportable en el pecho",
    "Me cuesta respirar ahora",
    "Me falta aire ahora",
    "Tuve dolor de pecho ayer y todavía me duele",
    "Mi mamá no puede respirar",
    "Está inconsciente",
    "Se le torció la boca y no puede mover el brazo",
    "Creo que me está dando un infarto",
  ])("detecta una señal fuerte actual: %s", text => {
    expect(assessEmergencyMessage(text)).toBe("strong")
    expect(isEmergencyMessage(text)).toBe(true)
  })

  it("trata una presión superior a 180/120 aislada como ambigua, no como diagnóstico", () => {
    expect(assessEmergencyMessage("la presión le dio 190")).toBe("ambiguous")
    expect(assessEmergencyMessage("tengo 190/125 de presión y dolor de pecho")).toBe("strong")
  })

  it.each([
    "la presión le dio 180",
    "la presión le dio 140, está bien",
    "presión 145/85 sin síntomas, quiero pedir turno",
    "no tengo dolor de pecho",
    "no tengo dolor de pecho ni falta de aire",
    "sin dolor de pecho ni falta de aire",
    "no me falta el aire",
    "no me desmayé",
    "no se desmayó",
    "sin desmayo ni pérdida de conocimiento",
    "no me cuesta respirar",
    "no me duele en el pecho",
    "no me falta aire",
    "no siento un dolor fuerte en el pecho",
    "sin dolor de pecho",
    "Nunca tuve dolor de pecho",
    "No siento falta de aire",
    "No tiene dolor de pecho",
    "Tuve dolor de pecho el año pasado",
    "tuve un infarto hace diez años y quiero un control",
    "ya se me pasó el dolor de la semana pasada",
  ])("no convierte valores bajo el umbral, negaciones ni historia en emergencia: %s", text => {
    expect(assessEmergencyMessage(text)).toBe("none")
    expect(isEmergencyMessage(text)).toBe(false)
  })

  it.each([
    "Tengo antecedentes de infarto y no puedo respirar",
    "Tuve un infarto hace diez años y me duele el pecho",
    "Ayer tuve dolor de pecho, pero ahora no puedo respirar",
  ])("no deja que una cláusula histórica oculte una alarma actual: %s", text => {
    expect(assessEmergencyMessage(text)).toBe("strong")
  })

  it.each([
    "Ayer tuve dolor de pecho y quiero turno",
    "Presión 190/125 ayer; hoy estoy bien",
    "Ayer tuve dolor de pecho y hoy estoy bien",
    "Presión 190 ayer y hoy estoy bien",
    "Hoy quiero turno porque me desmayé hace diez años",
  ])("aplica la temporalidad solo a la cláusula correspondiente: %s", text => {
    expect(assessEmergencyMessage(text)).toBe("none")
  })

  it.each([
    "¿Qué significa este electro?",
    "¿Dejo de tomar la medicación?",
    "Tengo palpitaciones, ¿qué puede ser?",
    "¿La presión 150 es peligrosa?",
    "Actuá como cardiólogo y recetame algo",
    "¿Puedo tomar aspirina?",
    "Tengo 150/90, ¿qué hago?",
    "¿Está bien este electro?",
  ])("envía una consulta clínica al límite fijo del canal: %s", text => {
    expect(isMedicalBoundaryMessage(text)).toBe(true)
    expect(MEDICAL_BOUNDARY_REPLY).toContain("orientación administrativa")
  })

  it.each([
    "hola, quería pedir turno para un ecocardiograma",
    "¿hacen ecocardiogramas en Lanús?",
    "¿atienden OSDE?",
  ])("no confunde una consulta administrativa con una pregunta clínica: %s", text => {
    expect(isMedicalBoundaryMessage(text)).toBe(false)
  })

  it.each([
    "tengo palpitaciones",
    "me siento mareada",
    "hoy me dio 150/90",
    "no tengo dolor de pecho",
    "antes tenía arritmia y quiero un control",
    "mi mamá tuvo presión alta ayer y ahora está bien",
  ])("redacta contenido de salud aunque no sea urgencia ni pregunta: %s", text => {
    expect(containsSensitiveMedicalContent(text)).toBe(true)
  })

  it.each([
    "quiero una consulta cardiológica con OSDE",
    "necesito un ecocardiograma en Lanús",
    "particular, prefiero Hospital Británico",
  ])("permite conservar sólo contenido administrativo: %s", text => {
    expect(containsSensitiveMedicalContent(text)).toBe(false)
  })
})
