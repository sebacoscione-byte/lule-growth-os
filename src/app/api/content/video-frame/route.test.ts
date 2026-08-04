jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/content-pipeline", () => ({ readContentItems: jest.fn() }))
jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/ai", () => ({
  generateVideoReferenceFrame: jest.fn(),
  reviewVideoReferenceFrame: jest.fn(),
  getPublicAiError: jest.fn(() => "error"),
}))

import { POST } from "./route"
import { generateVideoReferenceFrame, reviewVideoReferenceFrame } from "@/lib/ai"
import { readContentItems } from "@/lib/content-pipeline"
import { createClient } from "@/lib/supabase/server"
import { getServiceDb } from "@/lib/supabase/service"
import { authorizeStaff } from "@/lib/staff-authz"

const scores = {
  semanticRelevance: 5, firstSecondHook: 5, meaningfulMotion: 5, humanAuthenticity: 5,
  medicalCredibility: 5, profileVisualConsistency: 5, originalityVersusRecentPosts: 5, artifactRisk: 5,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({})
  ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true, role: "owner" })
  ;(readContentItems as jest.Mock).mockResolvedValue([])
  ;(generateVideoReferenceFrame as jest.Mock).mockResolvedValue({ mime_type: "image/jpeg", image_data: "aW1hZ2U=" })
  ;(getServiceDb as jest.Mock).mockReturnValue({ storage: { from: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue({ error: null }),
    getPublicUrl: jest.fn(() => ({ data: { publicUrl: "https://media.example/frame.jpg" } })),
  })) } })
})

function request() {
  return new Request("http://localhost/api/content/video-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId: "draft-1", topic: "Control cardiovascular", reference_image_prompt: "Adult patient during a preventive check" }),
  })
}

describe("POST /api/content/video-frame", () => {
  it("rechaza el estetoscopio sobre abdomen y regenera antes de guardar", async () => {
    ;(reviewVideoReferenceFrame as jest.Mock)
      .mockResolvedValueOnce({ approved: false, critical_failures: ["STETHOSCOPE_ON_ABDOMEN"], notes: "Ubicación incorrecta", scores: { ...scores, medicalCredibility: 1 } })
      .mockResolvedValueOnce({ approved: true, critical_failures: [], notes: "Correcto", scores })

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(generateVideoReferenceFrame).toHaveBeenCalledTimes(2)
    expect((generateVideoReferenceFrame as jest.Mock).mock.calls[1][0].reference_image_prompt).toMatch(/STETHOSCOPE_ON_ABDOMEN/)
    expect(await response.json()).toEqual(expect.objectContaining({ attempts: 2, video_reference_frame_url: "https://media.example/frame.jpg" }))
  })

  it("no guarda ni habilita un fotograma que falla tres revisiones", async () => {
    ;(reviewVideoReferenceFrame as jest.Mock).mockResolvedValue({
      approved: false, critical_failures: ["STETHOSCOPE_ON_ABDOMEN"], notes: "Ubicación incorrecta", scores: { ...scores, medicalCredibility: 1 },
    })
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(generateVideoReferenceFrame).toHaveBeenCalledTimes(3)
    expect(getServiceDb).not.toHaveBeenCalled()
    expect(await response.json()).toEqual(expect.objectContaining({ code: "VIDEO_FRAME_REJECTED" }))
  })
})
