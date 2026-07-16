import {
  classifyMessage,
  generateFollowupSuggestion,
  generateReply,
  stripMarkdownArtifacts,
} from "@/lib/ai"
import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY } from "@/lib/medical-safety"

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

describe("catálogo cerrado para respuestas dirigidas a pacientes", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("un proveedor no debe ejecutarse"))
  })

  afterEach(() => fetchSpy.mockRestore())

  it("responde una señal de alarma con texto fijo sin invocar un proveedor", async () => {
    await expect(generateReply("No puedo respirar", "contexto", [])).resolves.toBe(EMERGENCY_REPLY)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("responde una consulta clínica con el límite fijo sin invocar un proveedor", async () => {
    await expect(generateReply("¿Dejo de tomar la medicación?", "contexto", [])).resolves.toBe(MEDICAL_BOUNDARY_REPLY)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("un seguimiento con historial clínico tampoco genera texto libre", async () => {
    await expect(generateFollowupSuggestion("contexto", [
      { role: "user", content: "¿Qué significa este electro?" },
    ])).resolves.toBe(MEDICAL_BOUNDARY_REPLY)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["Me duele el pecho ahora", EMERGENCY_REPLY, true],
    ["¿Dejo de tomar la medicación?", MEDICAL_BOUNDARY_REPLY, false],
  ])("clasifica seguridad antes de la IA incluso en modo manual: %s", async (message, expectedReply, emergency) => {
    const previousMode = process.env.NEXT_PUBLIC_AI_MODE
    process.env.NEXT_PUBLIC_AI_MODE = "manual"
    try {
      const result = await classifyMessage(message)
      expect(result.reply_suggestion).toBe(expectedReply)
      expect(result.possible_emergency).toBe(emergency)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      if (previousMode === undefined) delete process.env.NEXT_PUBLIC_AI_MODE
      else process.env.NEXT_PUBLIC_AI_MODE = previousMode
    }
  })
})
