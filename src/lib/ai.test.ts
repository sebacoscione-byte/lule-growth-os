import { stripMarkdownArtifacts } from "@/lib/ai"

describe("stripMarkdownArtifacts", () => {
  it("saca titulos de Markdown (# con espacio) sin tocar hashtags reales", () => {
    expect(stripMarkdownArtifacts("### ¿Cuándo consultar a una cardióloga?")).toBe("¿Cuándo consultar a una cardióloga?")
    expect(stripMarkdownArtifacts("## Un título")).toBe("Un título")
    expect(stripMarkdownArtifacts("#cardiologia #salud")).toBe("#cardiologia #salud") // hashtag real, sin espacio
  })

  it("saca negrita (**texto**) dejando el texto", () => {
    expect(stripMarkdownArtifacts("**Frecuencia:** ¿Te pasa seguido?")).toBe("Frecuencia: ¿Te pasa seguido?")
  })

  it("convierte viñetas de Markdown (* o -) en una viñeta real", () => {
    expect(stripMarkdownArtifacts("* Frecuencia: ¿Te pasa seguido?")).toBe("• Frecuencia: ¿Te pasa seguido?")
    expect(stripMarkdownArtifacts("- Intensidad: ¿Son muy molestas?")).toBe("• Intensidad: ¿Son muy molestas?")
  })

  it("caso real: limpia un caption completo con titulos, negrita y vinetas mezclados", () => {
    const raw = `¿Palpitaciones? ¡Tranqui!

### ¿Cuándo consultar a una cardióloga?

* **Frecuencia:** ¿Te pasa seguido?
* **Intensidad:** ¿Son muy molestas?`

    const cleaned = stripMarkdownArtifacts(raw)
    expect(cleaned).not.toContain("###")
    expect(cleaned).not.toContain("**")
    expect(cleaned).not.toMatch(/^\* /m)
    expect(cleaned).toContain("¿Cuándo consultar a una cardióloga?")
    expect(cleaned).toContain("• Frecuencia: ¿Te pasa seguido?")
    expect(cleaned).toContain("• Intensidad: ¿Son muy molestas?")
  })

  it("no rompe texto que ya viene en texto plano", () => {
    const plain = "Hola! Atiendo los martes en CIMEL Lanús. Pedí tu turno por WhatsApp 💙"
    expect(stripMarkdownArtifacts(plain)).toBe(plain)
  })
})
