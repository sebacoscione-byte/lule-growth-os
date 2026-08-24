// Root fix del bug del carrusel (2026-08-17): al editar el contenido de una pieza aprobada/publicada,
// vuelve a borrador -- y su auto_publish_result queda viejo. Si no se limpia, al reaprobar + "Publicar
// ahora" el canal se saltea por creerlo ya publicado. Aca se fija que la reversion a borrador por edicion
// de contenido limpia ese resultado, y que un cambio que NO es de contenido (ej. cronograma) lo conserva.
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/content-pipeline", () => ({
  ...jest.requireActual("@/lib/content-pipeline"),
  compareAndSwapContentItems: jest.fn(),
  readContentItems: jest.fn(),
  readContentItemsSnapshot: jest.fn(),
  mutateContentItems: jest.fn(),
}))
jest.mock("@/lib/content-insights", () => ({ readContentInsightWindows: jest.fn() }))

import { PATCH } from "./route"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"
import { compareAndSwapContentItems, readContentItemsSnapshot } from "@/lib/content-pipeline"
import type { ContentItem } from "@/types"

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "carrusel-1",
    topic: "Triglicéridos",
    category: "Educación",
    format: "carrusel",
    goal: "Informar",
    status: "published",
    channels: ["instagram"],
    hook: "Hook original",
    caption: "Caption",
    google_text: "Google",
    hashtags: "#salud",
    visual_headline: "Triglicéridos",
    visual_subtitle: "Cardiología",
    visual_style: "rose",
    visual_url: "https://example.com/portada.jpg",
    slides: [{ headline: "S1", text: "T1", visual_url: "https://example.com/s1.jpg" }],
    auto_publish_result: { instagram: "published" },
    source: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    approved_at: "2026-08-02T10:00:00.000Z",
    ...overrides,
  }
}

function patch(body: Record<string, unknown>) {
  return new Request("http://localhost/api/content/items", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

describe("PATCH /api/content/items — limpiar resultado de publicacion viejo", () => {
  let written: ContentItem[] | null

  beforeEach(() => {
    jest.clearAllMocks()
    written = null
    ;(createClient as jest.Mock).mockResolvedValue({})
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
    ;(compareAndSwapContentItems as jest.Mock).mockImplementation(async (_db, _expected, items: ContentItem[]) => {
      written = items
      return true
    })
  })

  it("limpia auto_publish_result al volver a borrador por editar el contenido", async () => {
    ;(readContentItemsSnapshot as jest.Mock).mockResolvedValue({
      items: [item()],
      version: "2026-08-24T10:00:00.000Z",
    })

    const response = await PATCH(patch({ id: "carrusel-1", hook: "Hook corregido" }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.status).toBe("draft")
    expect(data.item.auto_publish_result).toEqual({})
    expect(written?.[0].auto_publish_result).toEqual({})
  })

  it("conserva auto_publish_result cuando el cambio no es de contenido (no revierte a borrador)", async () => {
    ;(readContentItemsSnapshot as jest.Mock).mockResolvedValue({
      items: [item({ status: "approved" })],
      version: "2026-08-24T10:00:00.000Z",
    })

    const response = await PATCH(patch({ id: "carrusel-1", repeat_interval_days: 1 }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.status).toBe("approved")
    expect(data.item.auto_publish_result).toEqual({ instagram: "published" })
  })

  it("devuelve conflicto y no pisa una edición concurrente", async () => {
    ;(readContentItemsSnapshot as jest.Mock).mockResolvedValue({
      items: [item()],
      version: "2026-08-24T10:00:00.000Z",
    })
    ;(compareAndSwapContentItems as jest.Mock).mockResolvedValue(false)

    const response = await PATCH(patch({ id: "carrusel-1", hook: "Edición local" }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.code).toBe("content_items_conflict")
    expect(data.error).toMatch(/otra sesión/i)
  })
})
