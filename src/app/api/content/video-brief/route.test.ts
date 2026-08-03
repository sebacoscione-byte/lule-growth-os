jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/staff-authz", () => ({ authorizeStaff: jest.fn() }))
jest.mock("@/lib/ai", () => ({ generateVideoBrief: jest.fn(), getPublicAiError: jest.fn(() => "error") }))

import { POST } from "./route"
import { generateVideoBrief } from "@/lib/ai"
import { createClient } from "@/lib/supabase/server"
import { authorizeStaff } from "@/lib/staff-authz"

beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({})
  ;(authorizeStaff as jest.Mock).mockResolvedValue({ ok: true, role: "owner" })
  ;(generateVideoBrief as jest.Mock).mockResolvedValue({ hook: "Hook", video_prompt: "Prompt", brief: {} })
})

function request(version?: string) {
  return new Request("http://localhost/api/content/video-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "Prevención",
      topic: "Control cardiovascular",
      objective: "educacion",
      ...(version ? { version } : {}),
    }),
  })
}

describe("POST /api/content/video-brief", () => {
  it("genera la propuesta con la versión V1 elegida", async () => {
    const response = await POST(request("v1"))

    expect(response.status).toBe(200)
    expect(generateVideoBrief).toHaveBeenCalledWith(expect.objectContaining({ version: "v1" }))
  })

  it("usa V2 por defecto y ante una versión desconocida", async () => {
    await POST(request("otra"))

    expect(generateVideoBrief).toHaveBeenCalledWith(expect.objectContaining({ version: "v2" }))
  })
})
