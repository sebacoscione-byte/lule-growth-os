jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/ai", () => ({ generateContentVideo: jest.fn(), getPublicAiError: jest.fn(() => "error") }))
jest.mock("@/lib/video-caption", () => ({ burnVideoBrief: jest.fn(), addBackgroundMusic: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/content-pipeline", () => ({ readContentItems: jest.fn() }))

import { POST } from "./route"
import { generateContentVideo } from "@/lib/ai"
import { buildFallbackVideoPrompt } from "@/lib/video-prompt"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"
import { addBackgroundMusic, burnVideoBrief } from "@/lib/video-caption"
import { readContentItems } from "@/lib/content-pipeline"

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
  ;(readContentItems as jest.Mock).mockResolvedValue([{
    id: "draft-1",
    video_reference_frame_path: "draft-1-video-frame-1.jpg",
    video_reference_frame_approved: true,
    video_reference_frame_review: {
      approved: true,
      critical_failures: [],
      notes: "ok",
      scores: {
        semanticRelevance: 5, firstSecondHook: 5, meaningfulMotion: 5, humanAuthenticity: 5,
        medicalCredibility: 5, profileVisualConsistency: 5, originalityVersusRecentPosts: 5, artifactRisk: 5,
      },
    },
  }])
  ;(getServiceDb as jest.Mock).mockReturnValue({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        download: jest.fn().mockResolvedValue({ data: new Blob([Buffer.from("frame")], { type: "image/jpeg" }), error: null }),
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
      version: "v2",
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
      video_prompt: buildFallbackVideoPrompt("Atención en Lanús", "v2"),
      version: "v2",
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "VIDEO_BRIEF_REQUIRED" }))
    expect(generateContentVideo).not.toHaveBeenCalled()
  })

  it("genera y compone una dirección editorial válida", async () => {
    const videoPrompt = buildFallbackVideoPrompt("Atención en Lanús", "v2")
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: videoPrompt,
      version: "v2",
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))

    expect(response.status).toBe(200)
    expect(generateContentVideo).toHaveBeenCalledWith({
      video_prompt: videoPrompt,
      version: "v2",
      reference_image: { mime_type: "image/jpeg", image_data: Buffer.from("frame").toString("base64") },
    })
    expect(burnVideoBrief).toHaveBeenCalledWith(expect.objectContaining({
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))
    expect(await response.json()).toEqual({ video_url: "https://media.example/video.mp4" })
  })

  it("mantiene operativo el motor ilustrado V1", async () => {
    const videoPrompt = buildFallbackVideoPrompt("Atención en Lanús", "v1")
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: videoPrompt,
      version: "v1",
      hook: "Tu control cerca",
      messages: ["Atención los martes"],
      cta: "Pedí turno",
    }))

    expect(response.status).toBe(200)
    expect(generateContentVideo).toHaveBeenCalledWith({ video_prompt: videoPrompt, version: "v1" })
  })

  it("bloquea V2 si el fotograma no fue aprobado", async () => {
    ;(readContentItems as jest.Mock).mockResolvedValue([{ id: "draft-1", video_reference_frame_approved: false }])
    const response = await POST(request({
      itemId: "draft-1",
      video_prompt: buildFallbackVideoPrompt("Prevención", "v2"),
      version: "v2",
      hook: "Cuidarte empieza hoy",
      messages: ["Un control concreto"],
      cta: "Consultá",
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: "VIDEO_FRAME_APPROVAL_REQUIRED" }))
    expect(generateContentVideo).not.toHaveBeenCalled()
  })
})
