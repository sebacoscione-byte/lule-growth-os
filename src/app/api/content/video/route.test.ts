jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/ai", () => ({ generateContentVideo: jest.fn(), getPublicAiError: jest.fn(() => "error") }))
jest.mock("@/lib/video-caption", () => ({ burnVideoBrief: jest.fn(), addBackgroundMusic: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { POST } from "./route"
import { generateContentVideo } from "@/lib/ai"
import { buildFallbackVideoPrompt } from "@/lib/video-prompt"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { addBackgroundMusic, burnVideoBrief } from "@/lib/video-caption"

const LEGACY_PROMPT = `A single continuous 6-second cinematic B-roll shot for a cardiology practice reel. Slow gentle camera dolly-in, realistic organic texture. A doctor hand points to an anatomical heart model. Vertical 9:16 composition.`

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/content/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({})
  ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true, role: "owner" })
  ;(generateContentVideo as jest.Mock).mockResolvedValue({
    mime_type: "video/mp4",
    video_data: Buffer.from("video").toString("base64"),
  })
  ;(burnVideoBrief as jest.Mock).mockImplementation(async ({ videoBuffer }) => videoBuffer)
  ;(addBackgroundMusic as jest.Mock).mockImplementation(async (videoBuffer) => videoBuffer)
  ;(getServiceDb as jest.Mock).mockReturnValue({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://media.example/video.mp4" } })),
      })),
    },
  })
})

describe("POST /api/content/video", () => {
  it("bloquea el prompt legado antes de consumir un intento pago", async () => {
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: LEGACY_PROMPT,
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "VIDEO_PROMPT_NEEDS_REFRESH" }))
    expect(generateContentVideo).not.toHaveBeenCalled()
  })

  it("exige la propuesta completa antes de generar el fondo", async () => {
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: buildFallbackVideoPrompt("Atención en Lanús"),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "VIDEO_BRIEF_REQUIRED" }))
    expect(generateContentVideo).not.toHaveBeenCalled()
  })

  it("genera y compone una dirección editorial válida", async () => {
    const videoPrompt = buildFallbackVideoPrompt("Atención en Lanús")
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: videoPrompt,
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))

    expect(response.status).toBe(200)
    expect(generateContentVideo).toHaveBeenCalledWith({ video_prompt: videoPrompt })
    expect(burnVideoBrief).toHaveBeenCalledWith(expect.objectContaining({
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))
    expect(await response.json()).toEqual({ video_url: "https://media.example/video.mp4" })
  })
})
