import {
  DEFAULT_DAILY_VIDEO_GENERATION_LIMIT,
  buildContentPlanPrompt,
  classifyMessage,
  generateContentPlan,
  generateContentVisual,
  generateFollowupSuggestion,
  generateReply,
  getContentVideoModel,
  getPublicAiError,
  proposeAutoDraftCategories,
  reviewVideoReferenceFrame,
  stripMarkdownArtifacts,
} from "@/lib/ai"
import { EMERGENCY_REPLY, MEDICAL_BOUNDARY_REPLY } from "@/lib/medical-safety"

describe("selección de modelo de video", () => {
  const originalGeneric = process.env.GEMINI_VIDEO_MODEL
  const originalV1 = process.env.GEMINI_VIDEO_MODEL_V1
  const originalV2 = process.env.GEMINI_VIDEO_MODEL_V2

  afterEach(() => {
    if (originalGeneric === undefined) delete process.env.GEMINI_VIDEO_MODEL
    else process.env.GEMINI_VIDEO_MODEL = originalGeneric
    if (originalV1 === undefined) delete process.env.GEMINI_VIDEO_MODEL_V1
    else process.env.GEMINI_VIDEO_MODEL_V1 = originalV1
    if (originalV2 === undefined) delete process.env.GEMINI_VIDEO_MODEL_V2
    else process.env.GEMINI_VIDEO_MODEL_V2 = originalV2
  })

  it("mantiene V1 en Fast y V2 en Standard por defecto", () => {
    delete process.env.GEMINI_VIDEO_MODEL
    delete process.env.GEMINI_VIDEO_MODEL_V1
    delete process.env.GEMINI_VIDEO_MODEL_V2

    expect(getContentVideoModel("v1")).toBe("veo-3.1-fast-generate-preview")
    expect(getContentVideoModel("v2")).toBe("veo-3.1-generate-preview")
  })

  it("no deja que el override histórico de V1 degrade silenciosamente V2", () => {
    process.env.GEMINI_VIDEO_MODEL = "veo-legacy-fast"
    delete process.env.GEMINI_VIDEO_MODEL_V1
    delete process.env.GEMINI_VIDEO_MODEL_V2

    expect(getContentVideoModel("v1")).toBe("veo-legacy-fast")
    expect(getContentVideoModel("v2")).toBe("veo-3.1-generate-preview")
  })
})

describe("límite diario de generación de video", () => {
  it("permite hasta 10 videos exitosos por día cuando no hay override", () => {
    expect(DEFAULT_DAILY_VIDEO_GENERATION_LIMIT).toBe(10)
  })
})

describe("revisión automática del fotograma V2", () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY
  const originalGeminiModel = process.env.GEMINI_MODEL
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  const validReview = JSON.stringify({
    approved: true,
    critical_failures: [],
    notes: "Fotograma creíble",
    scores: {
      semanticRelevance: 5,
      firstSecondHook: 4,
      meaningfulMotion: 4,
      humanAuthenticity: 5,
      medicalCredibility: 5,
      profileVisualConsistency: 5,
      originalityVersusRecentPosts: 4,
      artifactRisk: 5,
    },
  })

  function reviewResponse(text: string): Response {
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    } as unknown as Response
  }

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key"
    process.env.GEMINI_MODEL = "gemini-3.5-flash"
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalGeminiKey
    if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL
    else process.env.GEMINI_MODEL = originalGeminiModel
  })

  it("solicita JSON estructurado y limita el thinking del revisor multimodal", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(reviewResponse(validReview))

    const review = await reviewVideoReferenceFrame({
      topic: "Control cardiovascular",
      mime_type: "image/jpeg",
      image_data: "aW1hZ2U=",
    })

    expect(review.approved).toBe(true)
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(requestBody.generationConfig).toEqual(expect.objectContaining({
      responseMimeType: "application/json",
      responseJsonSchema: expect.objectContaining({ type: "object" }),
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 1100,
    }))
  })

  it("reintenta la revisión sobre la misma imagen cuando la primera respuesta es inválida", async () => {
    fetchSpy = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(reviewResponse("{\"approved\":"))
      .mockResolvedValueOnce(reviewResponse(validReview))

    const review = await reviewVideoReferenceFrame({
      topic: "Control cardiovascular",
      mime_type: "image/jpeg",
      image_data: "aW1hZ2U=",
    })

    expect(review.approved).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))
    expect(secondBody.contents[0].parts[1]).toEqual(firstBody.contents[0].parts[1])
  })
})

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

// Usado solo por el describe de fallback Gemini->Anthropic mas abajo -- el resto de los tests de
// este archivo fuerza AI_PROVIDER a un unico proveedor y nunca llega a instanciar el SDK real.
const anthropicCreateMock = jest.fn()
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => anthropicCreateMock(...args) },
  })),
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

// 2026-07-19: una categoria libre ("Investigacion medica", no una de las predefinidas) sin tema
// generó contenido sobre "diferencia entre electro y eco" -- un tema real de cardiologia, pero sin
// ninguna relacion con investigacion clinica/evidencia cientifica. La categoria llega tal cual la
// escribe el usuario; el prompt tiene que instruir explicitamente al modelo a no reinterpretarla
// hacia un tema cardiologico generico que le resulte mas comodo/conocido.
describe("buildContentPlanPrompt incluye la categoria pedida y la regla de coherencia (bug real 2026-07-19)", () => {
  const baseInput = { topic: "", category: "Investigación medica", format: "post", cta: "" }

  it("incluye la categoria pedida tal cual, sin reemplazarla por otra", () => {
    const prompt = buildContentPlanPrompt(baseInput)
    expect(prompt).toContain("Categoría: Investigación medica")
  })

  it("instruye a interpretar la categoria de forma literal y no reemplazarla por una mas conocida", () => {
    const prompt = buildContentPlanPrompt(baseInput)
    expect(prompt).toContain("COHERENCIA CON LA CATEGORIA")
    expect(prompt).toMatch(/interpretacion directa y reconocible de la categoria/i)
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

  // 2026-08-01: el truncamiento de JSON de Gemini es intermitente (confirmado en vivo -- el mismo
  // pedido repetido a veces sale bien y a veces no), asi que antes de saltar a otro proveedor vale la
  // pena reintentar una vez mas con el mismo. AI_PROVIDER="gemini" aisla el escenario a un unico
  // proveedor para poder medir la cantidad exacta de intentos.
  it("si el primer intento trunca, reintenta el mismo proveedor antes de rendirse", async () => {
    let callCount = 0
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      callCount += 1
      return callCount === 1 ? geminiHttpResponse(truncatedJson) : geminiHttpResponse(JSON.stringify(validPlan))
    })
    const result = await generateContentPlan(planInput)
    expect(result.hook).toBe("hook")
    expect(callCount).toBe(2)
  })

  it("agota el reintento (2 intentos) y recien ahi tira el error de JSON truncado", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(truncatedJson))
    await expect(generateContentPlan(planInput)).rejects.toThrow(/JSON incompleta o invalida/i)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("un error que no es de truncamiento (ej. API key invalida) NO se reintenta -- salta directo al siguiente paso", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "API key not valid" } }),
    } as unknown as Response)
    await expect(generateContentPlan(planInput)).rejects.toThrow(/API key not valid/i)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // 2026-08-05, a pedido explicito de Seba ("priorizá Gemini porque a Anthropic no le cargué
  // crédito"): antes, solo el truncamiento de JSON reintentaba el mismo proveedor -- cualquier OTRO
  // error transitorio (ej. un 5xx puntual, network blip) saltaba directo al fallback de Anthropic,
  // que hoy siempre falla por falta de saldo. Generalizado para que cualquier error que no sea
  // claramente permanente (billing/API key/cupo/modelo inexistente) tambien reintente Gemini una vez
  // mas antes de gastar una llamada garantizada a fallar contra el respaldo.
  it("un error transitorio que NO es de truncamiento (ej. 5xx puntual) SI reintenta el mismo proveedor", async () => {
    let callCount = 0
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) {
        return { ok: false, status: 503, json: async () => ({ error: { message: "Service Unavailable" } }) } as unknown as Response
      }
      return geminiHttpResponse(JSON.stringify(validPlan))
    })
    const result = await generateContentPlan(planInput)
    expect(result.hook).toBe("hook")
    expect(callCount).toBe(2)
  })

  it("un error PERMANENTE (ej. cupo agotado) NO reintenta, para no perder tiempo con un fallo garantizado", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Resource has been exhausted (e.g. check quota)." } }),
    } as unknown as Response)
    await expect(generateContentPlan(planInput)).rejects.toThrow(/resource has been exhausted/i)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // Caso cerrado 2026-07-20 (ver docs/BACKLOG.md): se habia reportado que el fallback a Anthropic no
  // se disparaba en un caso real -- confirmado que la causa era un AI_PROVIDER viejo en memoria de un
  // npm run dev ya corriendo (no recarga .env.local en caliente), no un bug de logica. Este test fija
  // el comportamiento correcto en modo "auto" (AI_PROVIDER=""): si Gemini falla, el loop sigue a
  // Anthropic en la misma llamada.
  it("en modo auto (AI_PROVIDER vacio), una falla de Gemini SI dispara el fallback a Anthropic", async () => {
    process.env.AI_PROVIDER = ""
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key" // el SDK va mockeado, el valor real no importa
    anthropicCreateMock.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(validPlan) }] })
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(truncatedJson))

    try {
      const result = await generateContentPlan(planInput)
      expect(result.hook).toBe("hook")
      expect(anthropicCreateMock).toHaveBeenCalledTimes(1)
    } finally {
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey
      anthropicCreateMock.mockReset()
    }
  })

  // Bug real 2026-08-01: en produccion, Gemini trunca el JSON (falla conocida, intermitente) Y el
  // fallback a Anthropic TAMBIEN falla (cuenta sin saldo: "Your credit balance is too low..."). El
  // fallback SI se disparaba, pero generateText siempre tiraba el error del PRIMER proveedor
  // (Gemini, "JSON incompleta o invalida") -- el usuario nunca veia el aviso real de "sin saldo" que
  // getPublicAiError ya sabe mostrar, y "intenta de nuevo" es enganioso cuando el bloqueo real es de
  // billing, no un bache puntual.
  it("si Gemini Y el fallback a Anthropic fallan, se propaga el error de Anthropic (el ultimo intentado), no el de Gemini", async () => {
    process.env.AI_PROVIDER = ""
    const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    anthropicCreateMock.mockRejectedValue(
      new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}')
    )
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(truncatedJson))

    expect.assertions(2)
    try {
      await generateContentPlan(planInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(getPublicAiError(error)).toMatch(/no tiene saldo disponible/i)
    } finally {
      if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previousAnthropicKey
      anthropicCreateMock.mockReset()
    }
  })
})

// 2026-08-06: Seba reporto que las historias generadas se leian como un post (titular tipo articulo +
// bajada explicativa) y no tenian sentido como historia, ya que una historia se publica SIN caption y
// SIN link (asStory en instagram-business.ts) -- el titular/subtitulo de la placa es todo el mensaje.
describe("reglas de historia vs post/carrusel en el contenido generado", () => {
  const planInput = {
    topic: "", category: "Ecocardiograma", format: "historia" as const, cta: "",
    objective: "educacion" as const, appointment_link: null, source: null,
  }
  const validPlan = {
    hook: "hook", caption: "caption", google_text: "google", hashtags: "#tag1 #tag2 #tag3",
    visual_headline: "titulo", visual_subtitle: "subtitulo", image_prompt: "prompt", image_alt_text: "alt",
  }

  function geminiHttpResponse(text: string) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    } as unknown as Response
  }

  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let previousProvider: string | undefined
  let previousDailyLimit: string | undefined
  let previousGeminiKey: string | undefined

  beforeEach(() => {
    previousProvider = process.env.AI_PROVIDER
    previousDailyLimit = process.env.DAILY_AI_REQUEST_LIMIT
    previousGeminiKey = process.env.GEMINI_API_KEY
    process.env.AI_PROVIDER = "gemini"
    process.env.DAILY_AI_REQUEST_LIMIT = "1000"
    process.env.GEMINI_API_KEY = "test-key"
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

  it("generateContentPlan: el system prompt incluye las reglas de historia (sin titulo+bajada, sin prometer datos que no estan, sin CTA de 'guardar')", async () => {
    let sentSystem = ""
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      sentSystem = body.systemInstruction.parts[0].text as string
      return geminiHttpResponse(JSON.stringify(validPlan))
    })
    await generateContentPlan(planInput)
    expect(sentSystem).toContain("HISTORIAS DE INSTAGRAM")
    // 2026-08-06, segunda vuelta: la primera regla saco el patron "titulo-articulo" pero el modelo se
    // corrio a otro roto -- prometer "3 datos clave"/"esta lista" sin escribirlos, y cerrar con
    // "Guarda esta info". Estas dos prohibiciones nuevas evitan especificamente eso.
    expect(sentSystem).toMatch(/PROHIBIDO prometer contenido que no esta/)
    expect(sentSystem).toMatch(/PROHIBIDO cerrar con "Guarda esto"/)
    expect(sentSystem).toMatch(/revisar el perfil de Instagram/)
  })

  it("buildContentPlanPrompt (modo manual): tambien incluye las reglas de historia, sin importar el formato pedido", () => {
    const promptForHistoria = buildContentPlanPrompt({ ...planInput, format: "historia" })
    const promptForPost = buildContentPlanPrompt({ ...planInput, format: "post" })
    // La regla es estatica (no depende del formato) para no romper el prompt caching -- el modelo la
    // aplica condicionalmente segun el "Formato Instagram" que ya viaja en el pedido.
    expect(promptForHistoria).toContain("HISTORIAS DE INSTAGRAM")
    expect(promptForHistoria).toMatch(/PROHIBIDO prometer contenido que no esta/)
    expect(promptForPost).toContain("HISTORIAS DE INSTAGRAM")
  })

  // 2026-08-06: bug real encontrado verificando la regla de arriba en vivo -- al pedirle un dato real
  // (en vez de una promesa vacia), el modelo escribio subtitulos de mas de 90 caracteres, que
  // buildDraftContentItem cortaba con un slice(0, 90) ciego a mitad de palabra. generateContentPlan
  // ahora usa truncateForImagePlate con el tope mas alto MAX_VISUAL_SUBTITLE_LENGTH (140).
  it("un visual_subtitle largo se corta en un limite de oracion, nunca a mitad de palabra", async () => {
    const longSubtitle = "Significa que trabaja con menos fuerza, no que se detiene por completo, y eso es fundamental entenderlo bien. Un control a tiempo te ayuda a protegerlo y mantenerlo funcionando lo mejor posible por mucho mas tiempo."
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      geminiHttpResponse(JSON.stringify({ ...validPlan, visual_subtitle: longSubtitle }))
    )
    const result = await generateContentPlan(planInput)
    expect(result.visual_subtitle.length).toBeLessThanOrEqual(140)
    expect(result.visual_subtitle).toBe("Significa que trabaja con menos fuerza, no que se detiene por completo, y eso es fundamental entenderlo bien.")
    expect(longSubtitle.startsWith(result.visual_subtitle)).toBe(true)
  })
})

// 2026-08-05: a pedido explicito de Seba, el generador automatico de borradores no solo tiene que
// rotar por antiguedad entre una lista fija de categorias -- tambien tiene que poder proponer
// categorias genuinamente nuevas mirando el historial de lo ya publicado/aprobado/en borrador (ver
// content-auto-draft.ts, buildAutoDraftPlan).
describe("proposeAutoDraftCategories", () => {
  function geminiHttpResponse(text: string) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    } as unknown as Response
  }

  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let previousProvider: string | undefined
  let previousDailyLimit: string | undefined
  let previousGeminiKey: string | undefined
  let previousAiMode: string | undefined

  beforeEach(() => {
    previousProvider = process.env.AI_PROVIDER
    previousDailyLimit = process.env.DAILY_AI_REQUEST_LIMIT
    previousGeminiKey = process.env.GEMINI_API_KEY
    previousAiMode = process.env.NEXT_PUBLIC_AI_MODE
    process.env.AI_PROVIDER = "gemini"
    process.env.DAILY_AI_REQUEST_LIMIT = "1000"
    process.env.GEMINI_API_KEY = "test-key"
    process.env.NEXT_PUBLIC_AI_MODE = "gemini_api"
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (previousProvider === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = previousProvider
    if (previousDailyLimit === undefined) delete process.env.DAILY_AI_REQUEST_LIMIT
    else process.env.DAILY_AI_REQUEST_LIMIT = previousDailyLimit
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousGeminiKey
    if (previousAiMode === undefined) delete process.env.NEXT_PUBLIC_AI_MODE
    else process.env.NEXT_PUBLIC_AI_MODE = previousAiMode
  })

  const baseInput = {
    count: 2,
    established_categories: ["Consulta cardiologica", "Colesterol"],
    recent_history: [{ category: "Colesterol", topic: "t", status: "published", days_ago: 3 }],
  }

  it("devuelve las categorias que propone la IA", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      geminiHttpResponse(JSON.stringify({ categories: ["Arritmias en el embarazo", "Factores de riesgo"] }))
    )
    await expect(proposeAutoDraftCategories(baseInput)).resolves.toEqual(["Arritmias en el embarazo", "Factores de riesgo"])
  })

  it("deduplica categorias repetidas que la IA haya devuelto por error", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      geminiHttpResponse(JSON.stringify({ categories: ["Colesterol alto", "colesterol alto", "Factores de riesgo"] }))
    )
    await expect(proposeAutoDraftCategories(baseInput)).resolves.toEqual(["Colesterol alto", "Factores de riesgo"])
  })

  it("tira un error claro si la IA no devuelve ninguna categoria", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(JSON.stringify({ categories: [] })))
    await expect(proposeAutoDraftCategories(baseInput)).rejects.toThrow(/respuesta incompleta/i)
  })

  it("tira un error claro si la IA devuelve solo strings vacios", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiHttpResponse(JSON.stringify({ categories: ["  ", ""] })))
    await expect(proposeAutoDraftCategories(baseInput)).rejects.toThrow(/no propuso ninguna categoría/i)
  })

  it("en modo manual no llama a ningun proveedor", async () => {
    const previousMode = process.env.NEXT_PUBLIC_AI_MODE
    process.env.NEXT_PUBLIC_AI_MODE = "manual"
    fetchSpy = jest.spyOn(global, "fetch").mockRejectedValue(new Error("no deberia llamarse"))
    try {
      await expect(proposeAutoDraftCategories(baseInput)).rejects.toThrow(/modo manual/i)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      if (previousMode === undefined) delete process.env.NEXT_PUBLIC_AI_MODE
      else process.env.NEXT_PUBLIC_AI_MODE = previousMode
    }
  })
})

// 2026-08-02: Seba reporto que "Generar placa final" seguia fallando con "No se pudo generar la
// respuesta con IA" pese a tener credito disponible en Gemini -- reproducido en vivo que un segundo
// intento identico sale bien, o sea la llamada a la API de imagenes de Gemini falla de forma puntual/
// transitoria (network blip, 5xx momentaneo, o un 200 OK sin datos de imagen), y a diferencia del
// texto (que ya reintenta desde el 2026-08-01), la generacion de imagen nunca tenia ningun reintento.
describe("generatePhotoWithGemini reintenta ante una falla transitoria (bug real 2026-08-02)", () => {
  // PNG real minimo (1x1) para que composeContentPlate (ffmpeg real, no mockeado) pueda decodificarlo.
  const MINIMAL_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

  const visualInput = {
    category: "Chequeo cardiovascular",
    topic: "Diagnostico",
    format: "post" as const,
    visual_headline: "Titulo",
    visual_subtitle: "Subtitulo",
    image_prompt: "A calm cardiology scene, no text.",
  }

  function geminiImageResponse(hasPhoto: boolean) {
    return {
      ok: true,
      json: async () => ({
        steps: [{
          type: "model_output",
          content: hasPhoto
            ? [{ type: "image", mime_type: "image/png", data: MINIMAL_PNG_BASE64 }]
            : [{ type: "text", text: "sin imagen" }], // 200 OK pero sin datos de imagen -- el caso real reportado
        }],
      }),
    } as unknown as Response
  }

  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let previousGeminiKey: string | undefined

  beforeEach(() => {
    previousGeminiKey = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = "test-key" // el fetch va mockeado, el valor real no importa
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousGeminiKey
  })

  it("si el primer intento no trae imagen, reintenta y arma la placa igual", async () => {
    let callCount = 0
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
      callCount += 1
      return geminiImageResponse(callCount > 1)
    })
    const result = await generateContentVisual(visualInput)
    expect(result.mime_type).toBe("image/png")
    expect(callCount).toBe(2)
  })

  it("agota el reintento (2 intentos) y recien ahi tira el error", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(geminiImageResponse(false))
    await expect(generateContentVisual(visualInput)).rejects.toThrow(/Gemini no devolvio una imagen/i)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("un error de cuota/rate-limit NO se reintenta (no se soluciona reintentando de inmediato)", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Resource has been exhausted (e.g. check quota)." } }),
    } as unknown as Response)
    await expect(generateContentVisual(visualInput)).rejects.toThrow(/resource has been exhausted/i)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  // 2026-08-03: Seba pidio poder elegir entre el motor V2 (foto sola + texto compuesto aparte) y el
  // original V1 (Gemini dibuja la placa entera de una sola pasada) por pieza, para comparar.
  // 2026-08-06: Seba marco V2 como "muy mala, corta la imagen al medio" y pidio volver a V1 por
  // default -- el default paso de "v2" a "v1" (ver generateContentVisual).
  it("sin version (o 'v1'): el prompt SI incluye el titular/subtitulo exactos -- Gemini dibuja la placa entera, sin composeContentPlate", async () => {
    let sentPrompt = ""
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      sentPrompt = body.input as string
      return geminiImageResponse(true)
    })
    const result = await generateContentVisual(visualInput)
    expect(sentPrompt).toContain(visualInput.visual_headline)
    expect(sentPrompt).toContain(visualInput.visual_subtitle)
    // V1 no pasa por composeContentPlate (ffmpeg) -- el mime_type es el que devolvio Gemini tal cual.
    expect(result.mime_type).toBe("image/png")
    expect(result.image_data).toBe(MINIMAL_PNG_BASE64)
  })

  it("version 'v1' explicita: mismo comportamiento que el default", async () => {
    let sentPrompt = ""
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      sentPrompt = body.input as string
      return geminiImageResponse(true)
    })
    const result = await generateContentVisual({ ...visualInput, version: "v1" })
    expect(sentPrompt).toContain(visualInput.visual_headline)
    expect(sentPrompt).toContain(visualInput.visual_subtitle)
    expect(result.mime_type).toBe("image/png")
    expect(result.image_data).toBe(MINIMAL_PNG_BASE64)
  })

  it("version 'v2' explicita: el prompt NUNCA menciona el titular/subtitulo real -- los compone composeContentPlate aparte", async () => {
    let callCount = 0
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      callCount += 1
      const body = JSON.parse((init as RequestInit).body as string)
      const sentPrompt = body.input as string
      expect(sentPrompt).not.toContain(visualInput.visual_headline)
      expect(sentPrompt).not.toContain(visualInput.visual_subtitle)
      expect(_url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions")
      expect(body).toMatchObject({
        model: "gemini-3.1-flash-image",
        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: "4:5",
          image_size: "2K",
        },
      })
      return geminiImageResponse(true)
    })
    const result = await generateContentVisual({ ...visualInput, version: "v2" })
    expect(result.mime_type).toBe("image/png")
    expect(callCount).toBe(1)
  })

  it("fija 9:16 y 2K en la API para historia/reel, no solo dentro del prompt", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.response_format).toMatchObject({ aspect_ratio: "9:16", image_size: "2K" })
      return geminiImageResponse(true)
    })

    await generateContentVisual({ ...visualInput, format: "reel" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
