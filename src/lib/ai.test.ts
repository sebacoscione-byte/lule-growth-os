import {
  classifyMessage,
  generateContentPlan,
  generateFollowupSuggestion,
  generateReply,
  getPublicAiError,
  stripMarkdownArtifacts,
} from "@/lib/ai"
import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY } from "@/lib/medical-safety"

// content_plan pega a Supabase (cache/log de ai_requests, ai_outputs) ademas del proveedor de IA --
// mockeado para no tocar la base real (local y prod comparten Supabase, ver CLAUDE.md) y para poder
// simular una respuesta truncada de Gemini sin depender de que la API realmente falle en el momento.
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }),
        gte: () => ({ eq: async () => ({ count: 0 }) }),
      }),
      upsert: async () => ({ error: null }),
      insert: async () => ({ error: null }),
    }),
  }),
}))

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

describe("generateText valida JSON antes de dar por exitosa la respuesta (bug real 2026-07-19)", () => {
  // Reproducido en vivo contra la API real de Gemini: con json:true, un proveedor a veces devuelve
  // texto NO VACIO pero truncado a mitad de un string (finishReason "STOP", muy por debajo del limite
  // de tokens -- no es un problema de maxTokens ni de prompt). generateWithGemini no lo detectaba
  // (no lanza si el texto no esta vacio), asi que generateText lo cacheaba y logueaba como exito; la
  // falla real recien aparecia un nivel arriba, en el JSON.parse de generateContentPlan, con un
  // mensaje que no matcheaba ningun caso de getPublicAiError y mostraba el generico "revisa la
  // configuracion del proveedor" (confuso: la config esta bien, fue una respuesta puntual truncada).
  const validPlan = {
    hook: "hook", caption: "caption", google_text: "google", hashtags: "#tag1 #tag2 #tag3",
    visual_headline: "titulo", visual_subtitle: "subtitulo", image_prompt: "prompt", image_alt_text: "alt",
  }
  // JSON valido hasta la mitad y despues cortado, sin comilla de cierre ni llave final -- calca el
  // caso real (ver texto crudo capturado en la reproduccion contra Gemini).
  const truncatedJson = `{"hook":"hook","caption":"caption","google_text":"google","hashtags":"#tag1 #tag2 #tag3","visual_headline":"titulo","visual_subtitle":"subtitulo","image_prompt":"prompt","image_alt_text":"al`

  function geminiHttpResponse(text: string) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    } as unknown as Response
  }

  const planInput = {
    topic: "", category: "Consulta cardiologica", format: "post" as const, cta: "",
    objective: "confianza" as const, appointment_link: null, source: null,
  }

  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let previousProvider: string | undefined
  let previousDailyLimit: string | undefined
  let previousGeminiKey: string | undefined

  beforeEach(() => {
    previousProvider = process.env.AI_PROVIDER
    previousDailyLimit = process.env.DAILY_AI_REQUEST_LIMIT
    previousGeminiKey = process.env.GEMINI_API_KEY
    process.env.AI_PROVIDER = "gemini" // aisla un unico proveedor para probar la validacion en si
    process.env.DAILY_AI_REQUEST_LIMIT = "1000"
    process.env.GEMINI_API_KEY = "test-key" // el fetch va mockeado, el valor real no importa
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (previousProvider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = previousProvider
    if (previousDailyLimit === undefined) delete process.env.DAILY_AI_REQUEST_LIMIT
    else process.env.DAILY_AI_REQUEST_LIMIT = previousDailyLimit
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousGeminiKey
  })

  it("un JSON truncado (finishReason STOP, texto no vacio) se trata como falla, no como exito silencioso", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(truncatedJson))
    await expect(generateContentPlan(planInput)).rejects.toThrow(/JSON incompleta o invalida/i)
  })

  it("esa falla se traduce a un aviso claro de reintentar, no al generico de configuracion", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(truncatedJson))
    expect.assertions(2)
    try {
      await generateContentPlan(planInput)
    } catch (error) {
      const publicMessage = getPublicAiError(error)
      expect(publicMessage).toMatch(/respuesta incompleta/i)
      expect(publicMessage).not.toMatch(/configuración del proveedor/i)
    }
  })

  it("un JSON completo se acepta y devuelve los campos generados (no regresion)", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(JSON.stringify(validPlan)))
    const result = await generateContentPlan(planInput)
    expect(result.hook).toBe("hook")
    expect(result.image_alt_text).toBe("alt")
  })
})
