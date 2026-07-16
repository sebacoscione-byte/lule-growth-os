import {
  InvalidWhatsAppWebhookError,
  hashWhatsAppPhone,
  normalizeWhatsAppWebhook,
} from "./whatsapp-webhook-normalizer"

function payload(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "123456789" }, ...value } }] }],
  }
}

describe("normalizeWhatsAppWebhook", () => {
  it("normaliza texto, nombre y referral con una lista permitida", () => {
    const result = normalizeWhatsAppWebhook(payload({
      contacts: [{ wa_id: "5491100000000", profile: { name: " Juana " } }],
      messages: [{
        id: "wamid.1",
        from: "5491100000000",
        timestamp: "1784160000",
        type: "text",
        text: { body: "Necesito un turno" },
        referral: {
          source_type: "ad",
          source_id: "123",
          ctwa_clid: "click-1",
          headline: "campo que no se conserva",
        },
      }],
    }))

    expect(result.invalidEventCount).toBe(0)
    expect(result.events).toEqual([expect.objectContaining({
      event_key: "wamid.1",
      event_type: "inbound",
      phone: "5491100000000",
      phone_hash: hashWhatsAppPhone("5491100000000"),
      message_type: "text",
      message_text: "Necesito un turno",
      wa_name: "Juana",
      referral: { source_type: "ad" },
      phone_number_id: "123456789",
    })])
    expect(JSON.stringify(result.events)).not.toContain("headline")
    expect(JSON.stringify(result.events)).not.toContain('"source_id"')
    expect(JSON.stringify(result.events)).not.toContain("click-1")
  })

  it.each(["audio", "image", "document", "sticker", "video", "location", "contacts"])(
    "preserva el tipo %s sin conservar metadata ni id del medio",
    type => {
      const result = normalizeWhatsAppWebhook(payload({
        messages: [{
          id: `wamid.${type}`,
          from: "5491100000000",
          type,
          [type]: { id: "media-id", caption: "posible dato sensible" },
        }],
      }))
      expect(result.events[0]).toEqual(expect.objectContaining({ message_type: type, message_text: "" }))
      expect(JSON.stringify(result.events[0])).not.toContain("media-id")
      expect(JSON.stringify(result.events[0])).not.toContain("posible dato sensible")
    }
  )

  it("normaliza botones interactivos y de template", () => {
    const result = normalizeWhatsAppWebhook(payload({
      messages: [
        {
          id: "wamid.button",
          from: "5491100000000",
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "acepto", title: "Sí" } },
        },
        {
          id: "wamid.template-button",
          from: "5491100000000",
          type: "button",
          button: { payload: "retomar", text: "Retomar" },
        },
      ],
    }))
    expect(result.events.map(event => [event.message_type, event.button_id, event.message_text])).toEqual([
      ["button_reply", "acepto", "Sí"],
      ["button_reply", "retomar", "Retomar"],
    ])
  })

  it("convierte estados de entrega en eventos idempotentes sin detalles libres del error", () => {
    const input = payload({
      statuses: [{
        id: "wamid.outbound",
        recipient_id: "5491100000000",
        status: "failed",
        timestamp: "1784160000",
        errors: [{ code: 131026, title: "dato que no debe persistirse", error_data: { details: "PII" } }],
      }],
    })
    const first = normalizeWhatsAppWebhook(input).events[0]
    const second = normalizeWhatsAppWebhook(input).events[0]
    expect(first.event_key).toBe(second.event_key)
    expect(first).toEqual(expect.objectContaining({
      event_type: "status",
      related_wa_message_id: "wamid.outbound",
      delivery_status: "failed",
      status_error_code: "131026",
    }))
    expect(JSON.stringify(first)).not.toContain("dato que no debe persistirse")
    expect(JSON.stringify(first)).not.toContain("PII")
  })

  it("convierte un evento inválido en DLQ técnica sin PII y sigue con los válidos", () => {
    const result = normalizeWhatsAppWebhook(payload({
      messages: [
        { from: "5491100000000", type: "text", text: { body: "sin id" } },
        { id: "wamid.ok", from: "5491100000000", type: "text", text: { body: "hola" } },
      ],
    }))
    expect(result.invalidEventCount).toBe(1)
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toEqual(expect.objectContaining({
      event_key: expect.stringMatching(/^invalid\.message\.[a-f0-9]{64}$/),
      phone: null,
      message_text: null,
      message_type: null,
      status_error_code: "invalid_normalized_event",
    }))
    expect(result.events[1].event_key).toBe("wamid.ok")
    expect(JSON.stringify(result.events[0])).not.toContain("sin id")
  })

  it("rechaza arrays desmedidos antes de recorrerlos", () => {
    const tooManyEntries = {
      object: "whatsapp_business_account",
      entry: Array.from({ length: 26 }, () => ({ changes: [] })),
    }
    expect(() => normalizeWhatsAppWebhook(tooManyEntries)).toThrow(InvalidWhatsAppWebhookError)
    try {
      normalizeWhatsAppWebhook(tooManyEntries)
    } catch (error) {
      expect((error as InvalidWhatsAppWebhookError).reason).toBe("too_many_events")
    }
  })
})
