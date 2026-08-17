// Bug real reportado por Seba (2026-08-17): un carrusel ya publicado que se borra en Instagram, se
// corrige y se vuelve a aprobar quedaba con auto_publish_result={instagram:"published"} viejo. Al tocar
// "Publicar ahora", resolveChannelsToPublish saltaba el canal por creerlo ya publicado, la lista de
// canales quedaba vacia y publishApprovedItem no publicaba nada: la pieza se quedaba en "aprobados" sin
// ningun error visible. Estos tests fijan que "Publicar ahora" republica cuando la lista queda vacia por
// un resultado viejo, sin romper la proteccion contra duplicar un reintento parcial legitimo.
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/content-pipeline", () => ({
  ...jest.requireActual("@/lib/content-pipeline"),
  readContentItems: jest.fn(),
  writeContentItems: jest.fn(),
}))
jest.mock("@/lib/content-publish", () => ({ publishApprovedItem: jest.fn() }))

import { POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems, writeContentItems } from "@/lib/content-pipeline"
import { publishApprovedItem } from "@/lib/content-publish"
import type { ContentChannel, ContentItem } from "@/types"

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "carrusel-1",
    topic: "Triglicéridos",
    category: "Educación",
    format: "carrusel",
    goal: "Informar",
    status: "approved",
    channels: ["instagram"],
    hook: "Hook",
    caption: "Caption",
    google_text: "Google",
    hashtags: "#salud",
    visual_headline: "Triglicéridos",
    visual_subtitle: "Cardiología",
    visual_style: "rose",
    visual_url: "https://example.com/portada.jpg",
    slides: [{ headline: "S1", text: "T1", visual_url: "https://example.com/s1.jpg" }],
    source: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    approved_at: "2026-08-02T10:00:00.000Z",
    ...overrides,
  }
}

function request(itemId = "carrusel-1") {
  return new Request("http://localhost/api/content/publish-now", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId }),
  })
}

describe("POST /api/content/publish-now — auto_publish_result viejo", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue({})
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
    ;(getServiceDb as jest.Mock).mockReturnValue({})
    ;(writeContentItems as jest.Mock).mockResolvedValue(undefined)
    ;(publishApprovedItem as jest.Mock).mockImplementation(
      async (_db: unknown, source: ContentItem, channels: ContentChannel[]) => ({
        item: { ...source, status: channels.length > 0 ? "published" : source.status },
        allPublished: channels.length > 0,
      })
    )
  })

  it("republica cuando el resultado viejo dejaria la lista de canales vacia (pieza reeditada)", async () => {
    const stale = item({ auto_publish_result: { instagram: "published" } })
    ;(readContentItems as jest.Mock).mockResolvedValue([stale])

    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(200)
    // Republica en el canal asignado en vez de saltarlo por el flag viejo.
    expect(publishApprovedItem).toHaveBeenCalledWith({}, stale, ["instagram"])
    expect(data.allPublished).toBe(true)
    expect(data.item.status).toBe("published")
  })

  it("no vuelve a postear un canal que ya salio bien en un reintento parcial real", async () => {
    // Instagram salio, Google fallo: la pieza sigue aprobada. "Publicar ahora" solo debe reintentar Google.
    const partial = item({
      channels: ["instagram", "google_business"],
      auto_publish_result: { instagram: "published", google_business: "error" },
    })
    ;(readContentItems as jest.Mock).mockResolvedValue([partial])

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(publishApprovedItem).toHaveBeenCalledWith({}, partial, ["google_business"])
  })

  it("rechaza publicar una pieza que no esta aprobada", async () => {
    ;(readContentItems as jest.Mock).mockResolvedValue([item({ status: "draft" })])

    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(publishApprovedItem).not.toHaveBeenCalled()
    expect(data.error).toContain("aprobada")
  })
})
