import type { SupabaseClient } from "@supabase/supabase-js"
import {
  compareAndSwapContentItems,
  mergeContentPublicationResult,
  mutateContentItems,
} from "@/lib/content-pipeline"
import type { ContentItem } from "@/types"

function item(id: string, topic: string): ContentItem {
  return {
    id,
    topic,
    category: "Educación",
    format: "post",
    goal: "Informar",
    status: "draft",
    channels: ["instagram"],
    hook: "Hook",
    caption: "Caption",
    google_text: "Google",
    hashtags: "#salud",
    visual_headline: topic,
    visual_subtitle: "Cardiología",
    visual_style: "rose",
    source: null,
    created_at: "2026-08-24T10:00:00.000Z",
    updated_at: "2026-08-24T10:00:00.000Z",
    approved_at: null,
  }
}

function fakeClient(
  reads: Array<{ items: ContentItem[]; version: string }>,
  casResults: boolean[]
) {
  const update = jest.fn()
  const versionEq = jest.fn()

  const supabase = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => {
            const read = reads.shift()
            return {
              data: read ? { value: read.items, updated_at: read.version } : null,
              error: null,
            }
          }),
        })),
      })),
      update: update.mockImplementation(() => ({
        eq: jest.fn(() => ({
          eq: versionEq.mockImplementation(() => ({
            select: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({
                data: casResults.shift() ? { key: "content_pipeline" } : null,
                error: null,
              })),
            })),
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient

  return { supabase, update, versionEq }
}

describe("biblioteca de contenido con compare-and-swap", () => {
  it("compara una versión corta en vez de serializar la Biblioteca en la URL", async () => {
    const version = "2026-08-24T10:00:00.000Z"
    const next = Array.from({ length: 100 }, (_, index) => item(String(index), "X".repeat(10_000)))
    const { supabase, versionEq } = fakeClient([], [true])

    await expect(compareAndSwapContentItems(supabase, version, next)).resolves.toBe(true)
    expect(versionEq).toHaveBeenCalledWith("updated_at", version)
  })

  it("reintenta sobre la versión más reciente y conserva el cambio concurrente", async () => {
    const original = [item("a", "Original")]
    const concurrent = [item("b", "Creado por otra sesión"), ...original]
    const { supabase, update } = fakeClient([
      { items: original, version: "2026-08-24T10:00:00.000Z" },
      { items: concurrent, version: "2026-08-24T10:01:00.000Z" },
    ], [false, true])

    const result = await mutateContentItems(supabase, items =>
      items.map(existing => existing.id === "a" ? { ...existing, topic: "Corregido" } : existing)
    )

    expect(result.map(existing => [existing.id, existing.topic])).toEqual([
      ["b", "Creado por otra sesión"],
      ["a", "Corregido"],
    ])
    expect(update).toHaveBeenCalledTimes(2)
  })

  it("no escribe si la mutación ya está aplicada", async () => {
    const original = [item("a", "Original")]
    const { supabase, update } = fakeClient([
      { items: original, version: "2026-08-24T10:00:00.000Z" },
    ], [])

    await expect(mutateContentItems(supabase, items => items)).resolves.toEqual(original)
    expect(update).not.toHaveBeenCalled()
  })

  it("no pisa una edición que se guardó mientras Meta estaba publicando", () => {
    const started = item("a", "Versión publicada")
    const latest = { ...started, topic: "Edición nueva", status: "draft" as const, updated_at: "2026-08-24T10:01:00.000Z" }
    const published = {
      ...started,
      status: "published" as const,
      auto_publish_result: { instagram: "published" as const },
      instagram_media_id: "media-123",
      published_at: "2026-08-24T10:00:30.000Z",
      updated_at: "2026-08-24T10:00:30.000Z",
    }

    expect(mergeContentPublicationResult(latest, started, published)).toMatchObject({
      topic: "Edición nueva",
      status: "draft",
      updated_at: "2026-08-24T10:01:00.000Z",
      instagram_media_id: "media-123",
      published_at: "2026-08-24T10:00:30.000Z",
    })
  })
})
