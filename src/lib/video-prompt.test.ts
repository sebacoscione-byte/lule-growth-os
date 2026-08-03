import {
  VEO_V2_NEGATIVE_PROMPT,
  buildFallbackVideoPrompt,
  getVeoPromptQualityIssues,
  getVeoRequestParameters,
  isPublishableVeoPrompt,
} from "@/lib/video-prompt"

const PAPER_CUT_PROMPT = `An 8-second vertical 9:16 2D editorial motion graphic. Subject and context: an ivory paper-cut field with one curved teal route. Action: a deep-blue dot travels once along the route. Style: restrained editorial cut-paper animation with clean edges. Camera and composition: locked camera, front-facing composition. Palette and light: ivory, deep blue and teal. Typography-free, entirely graphic, unpopulated frame; soft paper movement only, no speech. Fixed camera, seamless gentle loop.`

describe("versiones del prompt de Veo", () => {
  it("V1 conserva el fallback ilustrado original", () => {
    const prompt = buildFallbackVideoPrompt("Atención en Lanús", "v1")

    expect(prompt).toMatch(/^An 8-second vertical 9:16 clean medical motion graphic/)
    expect(prompt).toMatch(/flat or semi-flat illustration/i)
    expect(getVeoPromptQualityIssues(prompt, "v1")).toEqual([])
    expect(isPublishableVeoPrompt(prompt, "v1")).toBe(true)
  })

  it("V2 construye una toma documental completa y publicable", () => {
    const prompt = buildFallbackVideoPrompt("Atención en Lanús", "v2")

    expect(prompt).toMatch(/^An 8-second vertical 9:16 natural documentary video\./)
    expect(prompt).toContain("Subject and setting:")
    expect(prompt).toContain("Physical motion:")
    expect(prompt).toContain("Camera and composition:")
    expect(prompt).toContain("Natural light and finish:")
    expect(prompt).toContain("Ambient sound:")
    expect(prompt).toMatch(/locked tripod/i)
    expect(prompt).not.toMatch(/paper[- ]cut|2D|motion graphic|doctor|hand|stethoscope|anatomical heart/i)
    expect(getVeoPromptQualityIssues(prompt, "v2")).toEqual([])
  })

  it("V2 rechaza el paper-cut que produjo el ejemplo artificial", () => {
    const issues = getVeoPromptQualityIssues(PAPER_CUT_PROMPT, "v2")

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/formato documental V2/i),
      expect.stringMatching(/ilustrada o sintética/i),
    ]))
    expect(isPublishableVeoPrompt(PAPER_CUT_PROMPT, "v2")).toBe(false)
  })

  it("V2 rechaza personas y utilería clínica aunque el resto de la estructura sea válida", () => {
    const risky = `${buildFallbackVideoPrompt("prevención", "v2")} A doctor hand points to an anatomical heart model.`

    expect(getVeoPromptQualityIssues(risky, "v2")).toEqual(expect.arrayContaining([
      expect.stringMatching(/personas/i),
      expect.stringMatching(/utilería clínica/i),
    ]))
  })

  it("envía negativePrompt separado solo en V2 y mantiene duración numérica", () => {
    expect(getVeoRequestParameters("v1")).toEqual({
      aspectRatio: "9:16",
      resolution: "720p",
      durationSeconds: 8,
    })
    expect(getVeoRequestParameters("v2")).toEqual({
      aspectRatio: "9:16",
      resolution: "720p",
      durationSeconds: 8,
      negativePrompt: VEO_V2_NEGATIVE_PROMPT,
    })
    expect(typeof getVeoRequestParameters("v2").durationSeconds).toBe("number")
    expect(VEO_V2_NEGATIVE_PROMPT).toMatch(/paper-cut art.*human figures|human figures.*paper-cut art/i)
    expect(VEO_V2_NEGATIVE_PROMPT).not.toMatch(/\b(?:no|don't)\b/i)
  })
})
