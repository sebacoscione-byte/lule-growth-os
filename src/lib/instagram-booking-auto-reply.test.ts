jest.mock("@/lib/instagram-business", () => ({
  getValidToken: jest.fn(),
  getConnectionInfo: jest.fn(),
  getProfile: jest.fn(),
}))

import { getConnectionInfo, getProfile, getValidToken } from "@/lib/instagram-business"
import type { InstagramInboxItemInput } from "@/lib/instagram-webhook-normalizer"
import {
  INSTAGRAM_BOOKING_REPLY,
  INSTAGRAM_COVERAGE_REPLY,
  INSTAGRAM_LOCATION_REPLY,
  INSTAGRAM_PAMI_REPLY,
  getInstagramAutoReplyPlan,
  getInstagramAutoReplyText,
  isEligibleInstagramBookingInquiry,
  processInstagramBookingAutoReplies,
} from "./instagram-booking-auto-reply"

const ORIGINAL_FETCH = global.fetch

function item(overrides: Partial<InstagramInboxItemInput> = {}): InstagramInboxItemInput {
  return {
    external_id: "message:mid-1",
    instagram_account_id: "ig-business",
    item_type: "message",
    direction: "inbound",
    participant_id: "person-1",
    participant_username: null,
    conversation_id: null,
    media_id: null,
    content: "Hola, quiero sacar un turno",
    attachment_type: null,
    occurred_at: "2026-09-06T12:00:00.000Z",
    source: "webhook",
    expires_at: "2026-12-05T12:00:00.000Z",
    ...overrides,
  }
}

function db(options: { enabled?: boolean; claimId?: string | null; claimError?: boolean } = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: { enabled: options.enabled ?? true },
    error: null,
  })
  const secondEq = jest.fn().mockResolvedValue({ error: null })
  const firstEq = jest.fn(() => ({ eq: secondEq }))
  const update = jest.fn(() => ({ eq: firstEq }))
  const from = jest.fn((table: string) => {
    if (table === "instagram_auto_reply_settings") {
      return { select: () => ({ eq: () => ({ maybeSingle }) }) }
    }
    if (table === "instagram_auto_replies") return { update }
    throw new Error(`unexpected table ${table}`)
  })
  const rpc = jest.fn().mockResolvedValue({
    data: options.claimId === undefined ? "claim-1" : options.claimId,
    error: options.claimError ? { code: "failed" } : null,
  })
  return { client: { from, rpc } as never, from, rpc, update }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getValidToken as jest.Mock).mockResolvedValue("token")
  ;(getConnectionInfo as jest.Mock).mockResolvedValue({ instagram_user_id: "ig-business" })
  ;(getProfile as jest.Mock).mockResolvedValue({
    id: "ig-business",
    user_id: "ig-public",
    username: "draluciachahin",
  })
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ message_id: "sent-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }))
})

afterAll(() => { global.fetch = ORIGINAL_FETCH })

describe("isEligibleInstagramBookingInquiry", () => {
  it.each([
    "Quiero pedir un turno",
    "¿Cómo hago para sacar turno?",
    "Necesito una cita",
    "¿Hay turnos disponibles?",
    "Turno",
    "¿Turno?",
    "Hola, turno",
    "¿Tenés turno el martes?",
    "¿Tienen citas para esta semana?",
    "¿Qué obras sociales atendés en Lanús?",
    "¿Atienden por OSDE y cómo saco turno?",
    "Quiero atenderme de forma particular",
    "No tengo obra social",
    "¿Dónde atiende la doctora?",
    "¿Qué días atiende en CIMEL?",
    "¿Cuál es el horario de Swiss Medical Lomas?",
    "¿Dónde queda Hospital Británico Central?",
    "¿Atiende en Lanús?",
    "¿Atendés los viernes?",
    "¿Cómo llegar a CIMEL?",
  ])("acepta intención inequívoca: %s", content => {
    expect(isEligibleInstagramBookingInquiry(item({ content }))).toBe(true)
  })

  it.each([
    "Hola",
    "¿Cuánto sale un turno?",
    "Quiero cancelar mi turno",
    "Ya tengo turno",
    "Necesito turno por dolor de pecho",
    "Es urgente, quiero un turno",
    "¿Dónde puedo mandar un estudio para que lo revise?",
    "¿Qué horario me conviene para tomar la medicación?",
    "No tengo obra social y necesito turno por dolor de pecho",
    "¿Cuánto sale atenderme particular?",
    "Quiero cambiar mi turno en CIMEL",
    "Es un caso muy particular",
  ])("deja para una persona los casos ambiguos o sensibles: %s", content => {
    expect(isEligibleInstagramBookingInquiry(item({ content }))).toBe(false)
  })

  it("rechaza salientes, adjuntos, eliminados y participantes ausentes", () => {
    expect(isEligibleInstagramBookingInquiry(item({ direction: "outbound" }))).toBe(false)
    expect(isEligibleInstagramBookingInquiry(item({ attachment_type: "image" }))).toBe(false)
    expect(isEligibleInstagramBookingInquiry(item({ content: "[Mensaje eliminado]" }))).toBe(false)
    expect(isEligibleInstagramBookingInquiry(item({ participant_id: null }))).toBe(false)
  })

  it("elige una respuesta administrativa específica según la gestión", () => {
    expect(getInstagramAutoReplyText(item({ content: "¿Qué obras sociales atendés en Lanús?" })))
      .toBe(INSTAGRAM_COVERAGE_REPLY)
    expect(getInstagramAutoReplyText(item({ content: "Turno" }))).toBe(INSTAGRAM_BOOKING_REPLY)
    expect(getInstagramAutoReplyText(item({ content: "¿Qué días atiende en CIMEL?" })))
      .toBe(INSTAGRAM_LOCATION_REPLY)
    expect(getInstagramAutoReplyText(item({ content: "Quiero atenderme particular" })))
      .toBe(INSTAGRAM_COVERAGE_REPLY)
    expect(getInstagramAutoReplyText(item({ content: "¿Qué horarios atiende por OSDE?" })))
      .toBe(INSTAGRAM_COVERAGE_REPLY)
    expect(getInstagramAutoReplyText(item({ content: "Atienden x PAMI" })))
      .toBe(INSTAGRAM_PAMI_REPLY)
  })

  it("mantiene primera persona para coberturas y límites administrativos claros", () => {
    for (const reply of [INSTAGRAM_BOOKING_REPLY, INSTAGRAM_LOCATION_REPLY]) {
      expect(reply).toContain("asistente virtual administrativo")
      expect(reply).not.toMatch(/reserv(?:é|amos|ado)|turno confirmado|cobertura confirmada/i)
      expect(reply.length).toBeLessThanOrEqual(1_000)
    }
    for (const reply of [INSTAGRAM_COVERAGE_REPLY, INSTAGRAM_PAMI_REPLY]) {
      expect(reply).toContain("atiendo")
      expect(reply).not.toContain("asistente virtual administrativo")
      expect(reply).toContain("historias destacadas")
      expect(reply).toContain("página web")
      expect(reply).toContain("link de la bio")
      expect(reply.length).toBeLessThanOrEqual(1_000)
    }
    expect(INSTAGRAM_BOOKING_REPLY).toContain("link de la bio")
    expect(INSTAGRAM_BOOKING_REPLY).toContain("disponibilidad")
    expect(INSTAGRAM_COVERAGE_REPLY).toContain("dependen de la sede y del plan")
    expect(INSTAGRAM_PAMI_REPLY).toContain("no atiendo por PAMI")
  })

  it("publica las coberturas consultadas en comentarios y mantiene privados los DM", () => {
    expect(getInstagramAutoReplyPlan(item({
      external_id: "comment:coverage-1",
      item_type: "comment",
      content: "¿Atienden con Galeno?",
    }))).toEqual({ text: INSTAGRAM_COVERAGE_REPLY, delivery: "public_comment" })
    expect(getInstagramAutoReplyPlan(item({ content: "¿Atienden x PAMI?" })))
      .toEqual({ text: INSTAGRAM_PAMI_REPLY, delivery: "private_message" })
  })

  it("mantiene el cronograma vigente en la respuesta de sedes", () => {
    expect(INSTAGRAM_LOCATION_REPLY).toContain("CIMEL Lanús: Martes 13:00–15:00 · Jueves y viernes 13:00–16:00")
    expect(INSTAGRAM_LOCATION_REPLY).toContain("Hospital Británico Lanús (ecocardiogramas): Martes 16:00–19:30")
    expect(INSTAGRAM_LOCATION_REPLY).toContain("Hospital Británico Central: Miércoles 17:00–19:45")
    expect(INSTAGRAM_LOCATION_REPLY).toContain("Swiss Medical Lomas: Viernes 17:00–20:00")
  })
})

describe("processInstagramBookingAutoReplies", () => {
  it("envía un DM con la plantilla fija y registra el resultado", async () => {
    const store = db()
    const result = await processInstagramBookingAutoReplies(store.client, [item()])

    expect(result).toEqual({ eligible: 1, sent: 1, skipped: 0, failed: 0, indeterminate: 0 })
    expect(store.rpc).toHaveBeenCalledWith("claim_instagram_booking_auto_reply", expect.objectContaining({
      p_source_external_id: "message:mid-1",
      p_participant_id: "person-1",
      p_source_type: "message",
      p_target_id: "mid-1",
      p_reply_text: INSTAGRAM_BOOKING_REPLY,
    }))
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/ig-business/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
        body: JSON.stringify({
          recipient: { id: "person-1" },
          message: { text: INSTAGRAM_BOOKING_REPLY },
        }),
      })
    )
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "sent",
      meta_message_id: "sent-1",
      error_code: null,
    }))
  })

  it("responde un comentario por privado usando su comment_id", async () => {
    const store = db()
    await processInstagramBookingAutoReplies(store.client, [item({
      external_id: "comment:comment-9",
      item_type: "comment",
    })])
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/ig-business/messages",
      expect.objectContaining({
        body: JSON.stringify({
          recipient: { comment_id: "comment-9" },
          message: { text: INSTAGRAM_BOOKING_REPLY },
        }),
      })
    )
  })

  it("responde consultas de obras sociales sin prometer una cobertura", async () => {
    const store = db()
    const result = await processInstagramBookingAutoReplies(store.client, [item({
      content: "¿Qué obras sociales atendés en Lanús?",
    })])

    expect(result.sent).toBe(1)
    expect(store.rpc).toHaveBeenCalledWith("claim_instagram_booking_auto_reply", expect.objectContaining({
      p_reply_text: INSTAGRAM_COVERAGE_REPLY,
    }))
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/ig-business/messages",
      expect.objectContaining({
        body: JSON.stringify({
          recipient: { id: "person-1" },
          message: { text: INSTAGRAM_COVERAGE_REPLY },
        }),
      })
    )
    expect(INSTAGRAM_COVERAGE_REPLY).toContain("confirmar la cobertura directamente con la institución")
  })

  it("responde públicamente un comentario de cobertura", async () => {
    const store = db()
    ;(global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ id: "reply-comment-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))

    const result = await processInstagramBookingAutoReplies(store.client, [item({
      external_id: "comment:comment-coverage-1",
      item_type: "comment",
      content: "¿Atienden con OSDE?",
    })])

    expect(result.sent).toBe(1)
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/comment-coverage-1/replies",
      expect.objectContaining({
        body: JSON.stringify({ message: INSTAGRAM_COVERAGE_REPLY }),
      })
    )
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "sent",
      meta_message_id: "reply-comment-1",
    }))
  })

  it("responde PAMI con el texto específico y público", async () => {
    const store = db()
    await processInstagramBookingAutoReplies(store.client, [item({
      external_id: "comment:comment-pami-1",
      item_type: "comment",
      content: "Atienden x PAMI",
    })])

    expect(store.rpc).toHaveBeenCalledWith("claim_instagram_booking_auto_reply", expect.objectContaining({
      p_reply_text: INSTAGRAM_PAMI_REPLY,
    }))
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/comment-pami-1/replies",
      expect.objectContaining({
        body: JSON.stringify({ message: INSTAGRAM_PAMI_REPLY }),
      })
    )
  })

  it("acepta el user_id público del webhook y envía desde el id scoped de /me", async () => {
    const store = db()
    const result = await processInstagramBookingAutoReplies(store.client, [item({
      instagram_account_id: "ig-public",
    })])
    expect(result.sent).toBe(1)
    expect(store.rpc).toHaveBeenCalledWith("claim_instagram_booking_auto_reply", expect.objectContaining({
      p_instagram_account_id: "ig-business",
    }))
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/ig-business/messages",
      expect.anything()
    )
  })

  it("no obtiene token ni envía cuando la automatización está apagada", async () => {
    const store = db({ enabled: false })
    const result = await processInstagramBookingAutoReplies(store.client, [item()])
    expect(result).toEqual({ eligible: 1, sent: 0, skipped: 1, failed: 0, indeterminate: 0 })
    expect(getValidToken).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("no duplica cuando el claim ya existe o está dentro del cooldown", async () => {
    const store = db({ claimId: null })
    const result = await processInstagramBookingAutoReplies(store.client, [item()])
    expect(result.skipped).toBe(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("falla cerrado si el account id del evento no coincide con la cuenta conectada", async () => {
    const store = db()
    const result = await processInstagramBookingAutoReplies(store.client, [item({ instagram_account_id: "other" })])
    expect(result.skipped).toBe(1)
    expect(store.rpc).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("marca como indeterminado un timeout y no propaga detalles", async () => {
    const store = db()
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error("secret network detail"))
    const result = await processInstagramBookingAutoReplies(store.client, [item()])
    expect(result.indeterminate).toBe(1)
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "indeterminate",
      error_code: "network_indeterminate",
    }))
  })

  it("registra sólo códigos seguros ante un rechazo confirmado de Meta", async () => {
    const store = db()
    ;(global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      error: { message: "sensitive upstream detail", code: 10, error_subcode: 2018278 },
    }), { status: 400 }))
    const result = await processInstagramBookingAutoReplies(store.client, [item()])
    expect(result.failed).toBe(1)
    expect(store.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      error_code: "meta_400_10_2018278",
    }))
  })
})
