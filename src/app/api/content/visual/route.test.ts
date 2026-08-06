jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/content-pipeline", () => ({ readContentItems: jest.fn() }))
jest.mock("@/lib/ai", () => ({
  generateContentVisual: jest.fn(),
  regenerateImageDirection: jest.fn(),
  getPublicAiError: jest.fn(() => "error de IA"),
}))

import { POST } from "./route"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { readContentItems } from "@/lib/content-pipeline"
import { generateContentVisual, regenerateImageDirection } from "@/lib/ai"

const CARDIO_ONCOLOGY_PROMPT = `A warm, premium editorial photograph focusing on a close-up of a patient's hand resting gently on a wooden table in a brightly lit, welcoming medical consultation room. In the background, softly out of focus, is a female cardiologist's hand holding a pen near a medical chart. The lighting is soft and natural, coming from a nearby window, with warm wood tones and a deep teal accent.`

const LANUS_PROMPT = `An editorial and cinematic photograph of a warm, modern cardiologist consultation office. In the foreground, a clean desk made of light wood with a stethoscope, a blood pressure monitor, and a tablet showing a clean interface. A green plant sits in the background. A female doctor's arm in a white coat is partially visible near the desk.`

const NEW_PROMPT = `A tactile editorial paper-cut illustration about easy local access to preventive cardiovascular care. One route curves from a home shape toward a burgundy heart-shaped location marker beside a blank calendar tab. Focal point on the right. Do not render any text, letters, numbers, logos or watermarks anywhere in the image.`

function request(imagePrompt = LANUS_PROMPT) {
  return new Request("http://localhost/api/content/visual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      itemId: "lanus",
      sourceItemId: "lanus",
      category: "Atención en Lanús",
      topic: "Tu control cardiovascular en Lanús",
      format: "post",
      visual_headline: "TU CONTROL CARDIOVASCULAR EN LANÚS",
      visual_subtitle: "Atención médica personalizada",
      caption: "Información para pedir una consulta en la sede de Lanús.",
      image_prompt: imagePrompt,
      version: "v2",
    }),
  })
}

describe("POST /api/content/visual — diversidad V2", () => {
  const upload = jest.fn()
  const getPublicUrl = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue({})
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
    ;(readContentItems as jest.Mock).mockResolvedValue([
      { id: "lanus", image_prompt: LANUS_PROMPT, created_at: "2026-08-03T12:00:00Z" },
      { id: "cardio-onco", image_prompt: CARDIO_ONCOLOGY_PROMPT, created_at: "2026-07-30T12:00:00Z" },
    ])
    ;(regenerateImageDirection as jest.Mock).mockResolvedValue({
      image_prompt: NEW_PROMPT,
      image_alt_text: "Ilustración editorial de un recorrido hacia un control cardiovascular.",
    })
    ;(generateContentVisual as jest.Mock).mockResolvedValue({
      image_data: Buffer.from("imagen").toString("base64"),
      mime_type: "image/png",
    })
    upload.mockResolvedValue({ error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: "https://example.test/placa.png" } })
    ;(getServiceDb as jest.Mock).mockReturnValue({
      storage: { from: () => ({ upload, getPublicUrl }) },
    })
  })

  it("reemplaza el prompt repetitivo antes de consumir la generación de imagen", async () => {
    const response = await POST(request())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(regenerateImageDirection).toHaveBeenCalledWith(expect.objectContaining({
      previous_image_prompt: LANUS_PROMPT,
      recent_image_prompts: [LANUS_PROMPT, CARDIO_ONCOLOGY_PROMPT],
    }))
    expect(generateContentVisual).toHaveBeenCalledWith(expect.objectContaining({ image_prompt: NEW_PROMPT }))
    expect(data).toMatchObject({
      image_prompt: NEW_PROMPT,
      image_direction_refreshed: true,
      image_prompt_issues: ["generic-medical-office-scene", "too-similar-to-recent-content"],
    })
  })

  it("mantiene una dirección distinta sin invocar otra generación de texto", async () => {
    const response = await POST(request(NEW_PROMPT))

    expect(response.status).toBe(200)
    expect(regenerateImageDirection).not.toHaveBeenCalled()
    expect(generateContentVisual).toHaveBeenCalledWith(expect.objectContaining({ image_prompt: NEW_PROMPT }))
  })

  // 2026-08-06: hasta esta fecha, el control de diversidad de escena se saltaba para version "v1"
  // ("para que siguiera siendo una comparacion fiel con el motor historico" -- V1 era la variante
  // secundaria). Con V1 ahora como default, saltearlo para el caso mas comun hubiera sido una
  // regresion silenciosa de calidad -- ahora aplica sin importar la version.
  it("el control de diversidad tambien aplica sin version (default v1) y con version 'v1' explicita", async () => {
    const withoutVersion = new Request("http://localhost/api/content/visual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "lanus", sourceItemId: "lanus", category: "Atención en Lanús",
        topic: "Tu control cardiovascular en Lanús", format: "post",
        visual_headline: "TU CONTROL CARDIOVASCULAR EN LANÚS", visual_subtitle: "Atención médica personalizada",
        caption: "Información para pedir una consulta en la sede de Lanús.", image_prompt: LANUS_PROMPT,
      }),
    })
    const response = await POST(withoutVersion)

    expect(response.status).toBe(200)
    expect(regenerateImageDirection).toHaveBeenCalledWith(expect.objectContaining({
      previous_image_prompt: LANUS_PROMPT,
    }))
    expect(generateContentVisual).toHaveBeenCalledWith(expect.objectContaining({ image_prompt: NEW_PROMPT }))
  })
})

// 2026-08-06: bug real reportado por Seba -- una slide de carrusel larga se cortaba a mitad de
// oracion (ej. "...aumentando el") porque route.ts truncaba visual_subtitle a 120 caracteres antes
// de mandarlo a generateContentVisual, sin importar el motor. V1 dibuja el texto tal cual se le
// pasa (ver buildVisualPromptV1 en ai.ts) -- truncarlo produce una oracion incompleta quemada en la
// imagen. V2 sigue truncando: su layout compuesto por ffmpeg (composeContentPlate) esta calibrado
// para un texto acotado.
describe("POST /api/content/visual — no trunca el subtitulo para V1", () => {
  const LONG_SUBTITLE = "Cuando hay un exceso constante en sangre, pueden contribuir al desarrollo de placas en las arterias, aumentando el riesgo cardiovascular a largo plazo."

  function requestWithSubtitle(version: "v1" | "v2" | undefined) {
    return new Request("http://localhost/api/content/visual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: "slide-2", sourceItemId: "item-1", category: "Colesterol",
        topic: "El impacto en tus arterias", format: "carrusel",
        visual_headline: "2) El impacto en tus arterias", visual_subtitle: LONG_SUBTITLE,
        caption: "Caption completo del carrusel.", image_prompt: LANUS_PROMPT,
        ...(version ? { version } : {}),
      }),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue({})
    ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true })
    ;(readContentItems as jest.Mock).mockResolvedValue([])
    ;(generateContentVisual as jest.Mock).mockResolvedValue({
      image_data: Buffer.from("imagen").toString("base64"),
      mime_type: "image/png",
    })
    ;(getServiceDb as jest.Mock).mockReturnValue({
      storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ error: null }), getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: "https://example.test/slide.png" } }) }) },
    })
  })

  it("version 'v1' explicita: manda el subtitulo COMPLETO, sin cortar a mitad de oracion", async () => {
    await POST(requestWithSubtitle("v1"))
    expect(generateContentVisual).toHaveBeenCalledWith(expect.objectContaining({ visual_subtitle: LONG_SUBTITLE }))
  })

  it("sin version (el default): mismo comportamiento que 'v1' explicita", async () => {
    await POST(requestWithSubtitle(undefined))
    expect(generateContentVisual).toHaveBeenCalledWith(expect.objectContaining({ visual_subtitle: LONG_SUBTITLE }))
  })

  it("version 'v2': sigue truncando a 120 caracteres (composeContentPlate esta calibrado para eso)", async () => {
    await POST(requestWithSubtitle("v2"))
    const call = (generateContentVisual as jest.Mock).mock.calls[0][0]
    expect(call.visual_subtitle).not.toBe(LONG_SUBTITLE)
    expect(call.visual_subtitle.length).toBeLessThanOrEqual(120)
    expect(LONG_SUBTITLE.startsWith(call.visual_subtitle)).toBe(true)
  })
})
