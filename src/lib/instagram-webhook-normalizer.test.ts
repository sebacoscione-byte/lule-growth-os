import { InvalidInstagramWebhookError, normalizeInstagramWebhook } from "./instagram-webhook-normalizer"

describe("normalizeInstagramWebhook", () => {
  it("normaliza DMs entrantes y salientes sin conservar el payload crudo", () => {
    const result = normalizeInstagramWebhook({
      object: "instagram",
      entry: [{
        id: "ig-business",
        messaging: [
          {
            sender: { id: "person-1" }, recipient: { id: "ig-business" }, timestamp: 1788638400000,
            message: { mid: "mid-1", text: "¿Atienden OSDE?", attachments: [{ type: "image", payload: { url: "https://secret" } }] },
          },
          {
            sender: { id: "ig-business" }, recipient: { id: "person-1" }, timestamp: 1788638460000,
            message: { mid: "mid-2", text: "Hola", is_echo: true },
          },
        ],
      }],
    })
    expect(result.invalidEventCount).toBe(0)
    expect(result.items).toEqual([
      expect.objectContaining({ external_id: "message:mid-1", direction: "inbound", participant_id: "person-1", content: "¿Atienden OSDE?", attachment_type: "image" }),
      expect.objectContaining({ external_id: "message:mid-2", direction: "outbound", participant_id: "person-1", content: "Hola" }),
    ])
    expect(JSON.stringify(result.items)).not.toContain("https://secret")
  })

  it("acepta comentarios directos y dentro de changes, y deduplica", () => {
    const value = {
      id: "comment-1", from: { id: "person-2", username: "@ana" }, text: "¿Cuánto cobra?",
      media: { id: "media-1", media_product_type: "FEED" }, created_time: "2026-09-05T12:00:00Z",
    }
    const result = normalizeInstagramWebhook({
      object: "instagram",
      entry: [{ id: "ig-business", field: "comments", value, changes: [{ field: "comments", value }] }],
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(expect.objectContaining({
      external_id: "comment:comment-1",
      item_type: "comment",
      direction: "inbound",
      participant_username: "ana",
      media_id: "media-1",
      content: "¿Cuánto cobra?",
    }))
  })

  it("ignora reacciones y cuenta eventos de mensaje inválidos", () => {
    const result = normalizeInstagramWebhook({
      object: "instagram",
      entry: [{
        id: "ig-business",
        messaging: [
          { sender: { id: "person-1" }, recipient: { id: "ig-business" }, timestamp: 1, reaction: { mid: "m" } },
          { sender: { id: "person-1" }, recipient: { id: "ig-business" }, timestamp: 1, message: { text: "sin id" } },
        ],
      }],
    })
    expect(result.items).toHaveLength(0)
    expect(result.invalidEventCount).toBe(2)
  })

  it("rechaza esquemas ajenos y lotes desmedidos", () => {
    expect(() => normalizeInstagramWebhook({ object: "other", entry: [] })).toThrow(InvalidInstagramWebhookError)
    const messaging = Array.from({ length: 201 }, (_, index) => ({
      sender: { id: "p" }, recipient: { id: "ig" }, timestamp: 1,
      message: { mid: `m-${index}`, text: "x" },
    }))
    expect(() => normalizeInstagramWebhook({ object: "instagram", entry: [{ id: "ig", messaging }] }))
      .toThrow(InvalidInstagramWebhookError)
  })
})
