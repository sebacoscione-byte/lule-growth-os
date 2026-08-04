import {
  VEO_V2_NEGATIVE_PROMPT,
  buildFallbackVideoPrompt,
  buildFallbackVideoReferencePrompt,
  getVeoPromptQualityIssues,
  getVeoRequestInstance,
  getVeoRequestParameters,
  isPublishableVeoPrompt,
} from "@/lib/video-prompt"

describe("versiones del prompt de Veo", () => {
  it("V1 conserva el fallback ilustrado original", () => {
    const prompt = buildFallbackVideoPrompt("Atención en Lanús", "v1")
    expect(prompt).toMatch(/^An 8-second vertical 9:16 clean medical motion graphic/)
    expect(prompt).toMatch(/flat or semi-flat illustration/i)
    expect(getVeoPromptQualityIssues(prompt, "v1")).toEqual([])
  })

  it("V2 anima un fotograma aprobado sin reinventar la escena", () => {
    const prompt = buildFallbackVideoPrompt("Control cardiovascular", "v2")
    expect(prompt).toMatch(/^Animate the approved 9:16 first frame for 8 seconds\./)
    expect(prompt).toContain("Human action:")
    expect(prompt).toContain("Camera motion:")
    expect(prompt).toContain("Environment motion:")
    expect(prompt).toContain("Continuity:")
    expect(prompt).toContain("Audio:")
    expect(prompt).toMatch(/preserve the exact person/i)
    expect(getVeoPromptQualityIssues(prompt, "v2")).toEqual([])
    expect(isPublishableVeoPrompt(prompt, "v2")).toBe(true)
  })

  it("genera un fotograma humano documental y fija la falla crítica del estetoscopio", () => {
    const prompt = buildFallbackVideoReferencePrompt("Cardio-oncología")
    expect(prompt).toMatch(/editorial documentary healthcare photograph/i)
    expect(prompt).toMatch(/adult Latina patient/i)
    expect(prompt).toMatch(/chest\/thorax/i)
    expect(prompt).toMatch(/never on abdomen, belly or stomach/i)
  })

  it("V2 rechaza el contrato anterior de texto-a-video", () => {
    const old = "An 8-second vertical 9:16 natural documentary video. Subject and setting: a closed notebook. Physical motion: a curtain moves. Camera and composition: locked tripod. Natural light and finish: warm light. Ambient sound: room tone."
    expect(getVeoPromptQualityIssues(old, "v2")).toEqual(expect.arrayContaining([
      expect.stringMatching(/fotograma aprobado/i),
    ]))
  })

  it("envía imagen-a-video con adultos y exclusiones médicas solo en V2", () => {
    expect(getVeoRequestParameters("v1")).toEqual({ aspectRatio: "9:16", resolution: "720p", durationSeconds: 8 })
    expect(getVeoRequestParameters("v2")).toEqual(expect.objectContaining({
      aspectRatio: "9:16", resolution: "720p", durationSeconds: 8, personGeneration: "allow_adult",
      negativePrompt: VEO_V2_NEGATIVE_PROMPT,
    }))
    expect(VEO_V2_NEGATIVE_PROMPT).toMatch(/stethoscope on belly/i)
    expect(VEO_V2_NEGATIVE_PROMPT).toMatch(/extra fingers/i)
    expect(VEO_V2_NEGATIVE_PROMPT).not.toMatch(/human figures|patients/i)
    expect(VEO_V2_NEGATIVE_PROMPT).not.toMatch(/\b(?:no|don't)\b/i)
    expect(getVeoRequestInstance("Animate", { mime_type: "image/jpeg", image_data: "base64" })).toEqual({
      prompt: "Animate",
      image: { inlineData: { mimeType: "image/jpeg", data: "base64" } },
    })
  })
})
