import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import {
  INSTAGRAM_APPOINTMENT_MANAGEMENT_REPLY,
  INSTAGRAM_CONTACT_REPLY,
  INSTAGRAM_REQUIREMENTS_REPLY,
  INSTAGRAM_RESULTS_REPLY,
  INSTAGRAM_SPECIALTY_REPLY,
  getInstagramAutoReplyText,
} from "./instagram-booking-auto-reply"

function item(content: string): InstagramInboxItemInput {
  return {
    external_id: `message:${content}`,
    instagram_account_id: "ig-business",
    item_type: "message",
    direction: "inbound",
    participant_id: "person-1",
    participant_username: null,
    conversation_id: null,
    media_id: null,
    content,
    attachment_type: null,
    occurred_at: "2026-09-14T11:30:00.000Z",
    source: "webhook",
    expires_at: "2026-12-13T11:30:00.000Z",
  }
}

describe("Instagram administrative intents", () => {
  it.each([
    "En el británico de Lanús haces solo ecocardio o tmb consulta cardiológica?",
    "En Hospital Británico Lanús hacés consulta también o solo eco?",
  ])("responde la comparación de prestaciones exacta por sede: %s", content => {
    const reply = getInstagramAutoReplyText(item(content))
    expect(reply).toContain("Hospital Británico Lanús")
    expect(reply).toContain("ecocardiograma")
    expect(reply).toContain("consulta cardiológica")
    expect(reply).toContain("CIMEL Lanús")
  })

  it("responde qué prestación se realiza en una sede sin inventar otras", () => {
    const reply = getInstagramAutoReplyText(item("¿Qué prestaciones hacés en el Británico de Lanús?"))
    expect(reply).toContain("Hospital Británico Lanús")
    expect(reply).toContain("ecocardiograma")
    expect(reply).not.toContain("consulta cardiológica")
  })

  it("corrige una consulta de servicio incompatible con la sede usando la fuente estructurada", () => {
    const reply = getInstagramAutoReplyText(item("¿Hacés ecocardiograma en CIMEL?"))
    expect(reply).toContain("CIMEL Lanús")
    expect(reply).toContain("consulta cardiológica")
    expect(reply).toContain("Hospital Británico Lanús")
    expect(reply).toContain("ecocardiograma")
  })

  it("indica dónde realiza ecocardiogramas", () => {
    const reply = getInstagramAutoReplyText(item("¿Dónde hacés ecocardiogramas?"))
    expect(reply).toContain("Hospital Británico Lanús")
  })

  it("indica las sedes de consulta cardiológica", () => {
    const reply = getInstagramAutoReplyText(item("¿Dónde hacés consulta cardiológica?"))
    expect(reply).toContain("CIMEL Lanús")
    expect(reply).toContain("Hospital Británico Central")
    expect(reply).toContain("Swiss Medical Lomas")
  })

  it.each([
    "Quiero cambiar mi turno",
    "Necesito cancelar una cita",
    "¿Cómo confirmo mi turno?",
  ])("deriva gestión de turnos a la institución: %s", content => {
    expect(getInstagramAutoReplyText(item(content))).toBe(INSTAGRAM_APPOINTMENT_MANAGEMENT_REPLY)
  })

  it("responde contacto general", () => {
    expect(getInstagramAutoReplyText(item("¿Cuál es el teléfono de contacto?"))).toBe(INSTAGRAM_CONTACT_REPLY)
  })

  it("responde teléfono específico de una sede", () => {
    const reply = getInstagramAutoReplyText(item("¿Cuál es el teléfono del Británico de Lanús?"))
    expect(reply).toContain("0810-222-2748")
    expect(reply).toContain("Hospital Británico Lanús")
  })

  it.each([
    "¿Dónde retiro el informe?",
    "¿Cuándo están disponibles los resultados?",
  ])("deriva resultados administrativos sin interpretarlos: %s", content => {
    expect(getInstagramAutoReplyText(item(content))).toBe(INSTAGRAM_RESULTS_REPLY)
  })

  it.each([
    "¿Necesito orden para el estudio?",
    "¿Piden autorización para el estudio?",
    "¿Qué documentación tengo que llevar?",
  ])("deriva requisitos administrativos variables: %s", content => {
    expect(getInstagramAutoReplyText(item(content))).toBe(INSTAGRAM_REQUIREMENTS_REPLY)
  })

  it("responde la especialidad con una plantilla cerrada", () => {
    expect(getInstagramAutoReplyText(item("¿Qué especialidad tiene la doctora?")))
      .toBe(INSTAGRAM_SPECIALTY_REPLY)
  })

  it.each([
    "¿Cuánto cuesta la consulta cardiológica?",
    "Tengo dolor de pecho y necesito turno",
    "¿Podés interpretar mi ecocardiograma?",
    "Es urgente, quiero un turno",
    "Ya tengo turno, gracias",
  ])("mantiene fuera de automatización precio, contenido clínico, urgencias o flujos ya resueltos: %s", content => {
    expect(getInstagramAutoReplyText(item(content))).toBeNull()
  })
})
