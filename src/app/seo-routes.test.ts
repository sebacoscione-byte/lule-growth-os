import robots from "./robots"
import sitemap from "./sitemap"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

describe("rutas públicas para buscadores", () => {
  it("publica todas las landings y privacidad como URLs canónicas", () => {
    const entries = sitemap()
    const paths = entries.map(entry => new URL(entry.url).pathname)

    expect(paths).toEqual([
      ...PUBLIC_LANDING_SLUGS.map(slug => `/${slug}`),
      "/privacidad",
    ])
  })

  it("no inventa lastmod en cada build", () => {
    expect(sitemap().every(entry => entry.lastModified === undefined)).toBe(true)
  })

  it("mantiene sitemap y páginas públicas rastreables", () => {
    const output = robots()
    const rules = Array.isArray(output.rules) ? output.rules : [output.rules]
    const allowed = rules.flatMap(rule => rule.allow ?? [])

    expect(output.sitemap).toMatch(/\/sitemap\.xml$/)
    expect(allowed).toEqual(expect.arrayContaining([
      ...PUBLIC_LANDING_SLUGS.map(slug => `/${slug}`),
      "/privacidad",
    ]))
  })
})
