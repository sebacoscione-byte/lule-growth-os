import {
  VEO_REQUEST_PARAMETERS,
  buildFallbackVideoPrompt,
  getVeoPromptQualityIssues,
  isPublishableVeoPrompt,
} from "@/lib/video-prompt"

const LEGACY_DRAFT_PROMPT = `A single continuous 6-second cinematic B-roll shot for a cardiology practice reel about "TU CONTROL CARDIOVASCULAR EN LANUS". Slow gentle camera dolly-in or soft pan, warm natural lighting, sophisticated deep blue, burgundy and warm neutral palette, realistic organic texture. No people speaking, gesturing to explain, or looking directly at camera -- if a partial medical figure appears (hand, arm, coat), it must read as clearly feminine, never inventing a real face. No on-screen text, logos or watermark. Ambient sound only, no dialogue, no voiceover. Vertical 9:16 composition.`

describe("calidad del prompt de Veo", () => {
  it("rechaza el prompt legado exacto que produjo el consultorio artificial", () => {
    const issues = getVeoPromptQualityIssues(LEGACY_DRAFT_PROMPT)

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/publicidad cinematografica/i),
      expect.stringMatching(/fotorrealismo/i),
      expect.stringMatching(/personas/i),
    ]))
    expect(isPublishableVeoPrompt(LEGACY_DRAFT_PROMPT)).toBe(false)
  })

  it("construye un fallback 2D controlado y publicable", () => {
    const prompt = buildFallbackVideoPrompt("TU CONTROL CARDIOVASCULAR EN LANUS")

    expect(prompt).toMatch(/^An 8-second vertical 9:16 2D editorial motion graphic/)
    expect(prompt).toMatch(/locked camera/i)
    expect(prompt).toMatch(/typography-free/i)
    expect(prompt).not.toMatch(/cinematic|b-?roll|dolly|photorealistic|doctor|hand|stethoscope/i)
    expect(getVeoPromptQualityIssues(prompt)).toEqual([])
  })

  it("rechaza personas, utileria clinica y movimientos de camara aunque el inicio sea correcto", () => {
    const risky = `${buildFallbackVideoPrompt("prevencion")} A doctor hand points to an anatomical heart model while the camera dollies in.`

    expect(getVeoPromptQualityIssues(risky)).toEqual(expect.arrayContaining([
      expect.stringMatching(/personas/i),
      expect.stringMatching(/utileria clinica/i),
      expect.stringMatching(/publicidad cinematografica/i),
    ]))
  })

  it("fija ocho segundos para que el clip coincida con el guion compuesto", () => {
    expect(VEO_REQUEST_PARAMETERS).toEqual({
      aspectRatio: "9:16",
      resolution: "720p",
      durationSeconds: 8,
    })
    expect(typeof VEO_REQUEST_PARAMETERS.durationSeconds).toBe("number")
  })
})
