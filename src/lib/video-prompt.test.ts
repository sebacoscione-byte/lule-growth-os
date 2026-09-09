import {
  VIDEO_PROMPT_RULES_V1,
  VIDEO_VISUAL_IDENTITY_RULES,
  buildFallbackVideoPrompt,
  buildFallbackVideoReferencePrompt,
  getOmniVideoOutput,
  getOmniVideoRequestBody,
  getVideoPromptQualityIssues,
  getVeoRequestInstance,
  getVeoRequestParameters,
  isPublishableVideoPrompt,
} from "@/lib/video-prompt"

describe("versiones del prompt de video", () => {
  it("V1 conserva el fallback ilustrado original", () => {
    const prompt = buildFallbackVideoPrompt("Atención en Lanús", "v1")
    expect(prompt).toMatch(/^An 8-second vertical 9:16 clean medical motion graphic/)
    expect(prompt).toMatch(/flat or semi-flat illustration/i)
    expect(getVideoPromptQualityIssues(prompt, "v1")).toEqual([])
  })

  it("V2 anima un fotograma aprobado sin reinventar la escena", () => {
    const prompt = buildFallbackVideoPrompt("Control cardiovascular", "v2")
    expect(prompt).toMatch(/^Animate the approved 9:16 first frame into an 8-second video\./)
    expect(prompt).toContain("Shot:")
    expect(prompt).toContain("Human action:")
    expect(prompt).toContain("Camera motion:")
    expect(prompt).toContain("Environment motion:")
    expect(prompt).toContain("Continuity:")
    expect(prompt).toContain("Audio:")
    expect(prompt).toContain("Constraints:")
    expect(prompt).toMatch(/single unbroken scene.*(?:single|one) continuous shot.*no scene cuts/i)
    expect(prompt).toMatch(/preserve the exact person/i)
    expect(prompt).toMatch(/keep everything else exactly the same/i)
    expect(getVideoPromptQualityIssues(prompt, "v2")).toEqual([])
    expect(isPublishableVideoPrompt(prompt, "v2")).toBe(true)
  })

  it("genera un fotograma humano documental y fija la falla crítica del estetoscopio", () => {
    const prompt = buildFallbackVideoReferencePrompt("Cardio-oncología")
    expect(prompt).toMatch(/editorial documentary healthcare photograph/i)
    expect(prompt).toMatch(/adult Latina patient/i)
    expect(prompt).toMatch(/chest\/thorax/i)
    expect(prompt).toMatch(/never on abdomen, belly or stomach/i)
  })

  it("ubica estetoscopio y manguito de presión en el área corporal correcta", () => {
    expect(VIDEO_PROMPT_RULES_V1).toMatch(/estetoscopio.*pecho\/torax.*nunca abdomen/i)
    expect(VIDEO_PROMPT_RULES_V1).toMatch(/manguito de presion.*brazo.*encima del codo/i)
    expect(VIDEO_VISUAL_IDENTITY_RULES).toMatch(/manguito de presion de brazo.*encima del codo/i)
    expect(buildFallbackVideoPrompt("Control de presión", "v2_direct")).toMatch(/no visible text/i)
  })

  it("V2 Directa describe toda la escena sin fotograma inicial", () => {
    const prompt = buildFallbackVideoPrompt("Cardio-oncología", "v2_direct")
    expect(prompt).toMatch(/^An 8-second vertical 9:16 editorial documentary healthcare video\./)
    expect(prompt).toContain("Subject and setting:")
    expect(prompt).toContain("Shot:")
    expect(prompt).toContain("Human action:")
    expect(prompt).toContain("Camera and composition:")
    expect(prompt).toContain("Light and palette:")
    expect(prompt).toContain("Continuity:")
    expect(prompt).toContain("Audio:")
    expect(prompt).toContain("Constraints:")
    expect(prompt).not.toMatch(/approved (?:first )?frame/i)
    expect(prompt).toMatch(/single unbroken scene.*(?:single|one) continuous shot.*no scene cuts/i)
    expect(getVideoPromptQualityIssues(prompt, "v2_direct")).toEqual([])
    expect(isPublishableVideoPrompt(prompt, "v2_direct")).toBe(true)
  })

  it("V2 rechaza el contrato anterior de texto-a-video", () => {
    const old = "An 8-second vertical 9:16 natural documentary video. Subject and setting: a closed notebook. Physical motion: a curtain moves. Camera and composition: locked tripod. Natural light and finish: warm light. Ambient sound: room tone."
    expect(getVideoPromptQualityIssues(old, "v2")).toEqual(expect.arrayContaining([
      expect.stringMatching(/fotograma aprobado/i),
    ]))
  })

  it("conserva el contrato legado de Veo solamente para V1", () => {
    expect(getVeoRequestParameters()).toEqual({ aspectRatio: "9:16", resolution: "720p", durationSeconds: 8 })
    expect(getVeoRequestInstance("Animate", { mime_type: "image/jpeg", image_data: "base64" })).toEqual({
      prompt: "Animate",
      image: { inlineData: { mimeType: "image/jpeg", data: "base64" } },
    })
  })

  it("arma el request multimodal de Omni para V2 Controlada", () => {
    expect(getOmniVideoRequestBody("gemini-omni-1.1-flash", "Animate", {
      mime_type: "image/jpeg",
      image_data: "base64",
    })).toEqual({
      model: "gemini-omni-1.1-flash",
      input: [
        { type: "image", data: "base64", mime_type: "image/jpeg" },
        { type: "text", text: "Animate" },
      ],
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" },
      generation_config: { video_config: { task: "image_to_video" } },
      background: false,
      store: false,
      stream: false,
    })
  })

  it("arma el request de texto de Omni sin forzar image-to-video", () => {
    const request = getOmniVideoRequestBody("gemini-omni-1.1-flash", "One shot")
    expect(request.input).toBe("One shot")
    expect(request).not.toHaveProperty("generation_config")
  })

  it("extrae el video del esquema REST de Interactions", () => {
    expect(getOmniVideoOutput({
      steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "video64" }] }],
    })).toEqual({ type: "video", mime_type: "video/mp4", data: "video64" })
    expect(getOmniVideoOutput({ steps: [{ type: "thought", content: [{ type: "text" }] }] })).toBeUndefined()
  })
})
