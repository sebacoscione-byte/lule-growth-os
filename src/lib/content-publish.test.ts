import { publishApprovedItem, sanitizeContentPublishError } from "@/lib/content-publish"
import { publishImageToInstagram } from "@/lib/instagram-business"
import type { ContentItem } from "@/types"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/instagram-business")
jest.mock("@/lib/google-business")

const item: ContentItem = {
  id: "item-1",
  topic: "Control",
  category: "Educación",
  format: "post",
  goal: "Informar",
  status: "approved",
  channels: ["instagram"],
  hook: "Hook",
  caption: "Caption",
  google_text: "Google",
  hashtags: "#salud",
  visual_headline: "Control",
  visual_subtitle: "Cardiología",
  visual_style: "rose",
  visual_url: "https://example.com/image.jpg",
  source: null,
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-01T10:00:00.000Z",
  approved_at: "2026-08-02T10:00:00.000Z",
}

describe("publishApprovedItem", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-06T22:17:00.000Z"))
    ;(publishImageToInstagram as jest.Mock).mockResolvedValue({ mediaId: "ig-media-1" })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.resetAllMocks()
  })

  it("persiste el momento real junto con el media_id publicado", async () => {
    const result = await publishApprovedItem({} as SupabaseClient, item, ["instagram"])

    expect(result.allPublished).toBe(true)
    expect(result.item).toEqual(expect.objectContaining({
      status: "published",
      instagram_media_id: "ig-media-1",
      published_at: "2026-08-06T22:17:00.000Z",
    }))
  })

  it("conserva published_at al reintentar solamente otro canal", async () => {
    const existing = { ...item, published_at: "2026-08-05T22:00:00.000Z", instagram_media_id: "old-media" }
    const result = await publishApprovedItem({} as SupabaseClient, existing, [])

    expect(result.item.published_at).toBe(existing.published_at)
    expect(result.item.instagram_media_id).toBe(existing.instagram_media_id)
  })

  it("persiste una causa sanitizada cuando Instagram falla", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined)
    ;(publishImageToInstagram as jest.Mock).mockRejectedValue(
      new Error("Meta temporalmente no disponible https://graph.facebook.com/x?access_token=secreto&foo=1")
    )

    const result = await publishApprovedItem({} as SupabaseClient, item, ["instagram"])

    expect(result.allPublished).toBe(false)
    expect(result.errors.instagram).toBe(
      "Meta temporalmente no disponible https://graph.facebook.com/x?access_token=[redacted]&foo=1"
    )
    expect(result.item).toEqual(expect.objectContaining({
      status: "approved",
      auto_publish_result: { instagram: "error" },
      auto_publish_errors: { instagram: result.errors.instagram },
    }))
  })

  it("limpia el motivo viejo después de un reintento exitoso", async () => {
    const existing = {
      ...item,
      auto_publish_result: { instagram: "error" as const },
      auto_publish_errors: { instagram: "fallo anterior" },
    }

    const result = await publishApprovedItem({} as SupabaseClient, existing, ["instagram"])

    expect(result.item.auto_publish_errors).toEqual({})
    expect(result.errors).toEqual({})
  })
})

describe("sanitizeContentPublishError", () => {
  it("redacta credenciales en JSON y encabezados Bearer", () => {
    expect(sanitizeContentPublishError(
      new Error('{"token":"privado"} Authorization: Bearer tambien-privado')
    )).toBe('{"token":"[redacted]"} Authorization: Bearer [redacted]')
  })
})
