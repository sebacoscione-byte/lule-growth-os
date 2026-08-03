import {
  areImagePromptsTooSimilar,
  getImagePromptQualityIssues,
  recentImagePrompts,
} from "@/lib/image-prompt-quality"

const CARDIO_ONCOLOGY_PROMPT = `A warm, premium editorial photograph focusing on a close-up of a patient's hand resting gently on a wooden table in a brightly lit, welcoming medical consultation room. In the background, softly out of focus, is a female cardiologist's hand holding a pen near a medical chart, suggesting a supportive and calm conversation. The lighting is soft and natural, coming from a nearby window, creating a comforting and reassuring atmosphere. The color palette features warm wood tones, soft whites, and a deep teal accent. A clean, high-contrast empty space is reserved on the left side for text. No extra text, no logos, no watermark.`

const LANUS_PROMPT = `An editorial and cinematic photograph of a warm, modern cardiologist consultation office in Argentina during daytime. In the foreground, a professional and clean desk made of light wood with a stethoscope, a blood pressure monitor, and a tablet showing a clean interface. In the background, soft warm lighting, a comfortable patient chair, and a green plant. A female doctor's arm in a white coat is partially visible near the desk, conveying a welcoming presence. The scene feels premium, trustworthy, and calm. Soft depth of field, natural light coming from a window, subtle teal and soft wood color palette. Negative space on the top left. Format 4:5. No extra text, no logos, no watermark.`

const DISTINCT_LOCATION_PROMPT = `A tactile editorial paper-cut illustration about easy local access to preventive cardiovascular care. One clear route curves from a simple home shape toward a burgundy heart-shaped location marker beside a blank calendar tab. Slightly imperfect cut-paper edges, restrained ivory, deep blue and teal palette, soft directional shadows, fixed overhead composition, focal point on the right. No people, medical office, desk, stethoscope, screen or clinic photograph. Do not render any text, letters, numbers, logos or watermarks anywhere in the image.`

describe("calidad y diversidad de image_prompt", () => {
  it("detecta que los casos reales de Cardio-oncología y Lanús repiten la misma escena", () => {
    expect(areImagePromptsTooSimilar(LANUS_PROMPT, CARDIO_ONCOLOGY_PROMPT)).toBe(true)
    expect(getImagePromptQualityIssues(LANUS_PROMPT, [CARDIO_ONCOLOGY_PROMPT])).toEqual([
      "generic-medical-office-scene",
      "too-similar-to-recent-content",
    ])
  })

  it("acepta una dirección de sede que cambia de arquetipo visual", () => {
    expect(areImagePromptsTooSimilar(DISTINCT_LOCATION_PROMPT, CARDIO_ONCOLOGY_PROMPT)).toBe(false)
    expect(getImagePromptQualityIssues(DISTINCT_LOCATION_PROMPT, [CARDIO_ONCOLOGY_PROMPT])).toEqual([])
  })

  it("toma sólo prompts recientes de otras piezas", () => {
    expect(recentImagePrompts([
      { id: "actual", image_prompt: "actual", created_at: "2026-08-03T12:00:00Z" },
      { id: "viejo", image_prompt: "viejo", created_at: "2026-07-01T12:00:00Z" },
      { id: "nuevo", image_prompt: "nuevo", created_at: "2026-08-02T12:00:00Z" },
      { id: "sin-prompt", created_at: "2026-08-03T13:00:00Z" },
    ], "actual", 1)).toEqual(["nuevo"])
  })
})
