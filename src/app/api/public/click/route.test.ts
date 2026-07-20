jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 29 }),
  getClientIp: jest.fn(() => "127.0.0.1"),
}))

import { POST } from "./route"
import { getServiceDb } from "@/lib/supabase/service"
import { checkRateLimit } from "@/lib/rate-limit"
import { PUBLIC_LANDING_SLUGS } from "@/lib/public-landings"

function mockSupabaseInsert(error: { message: string } | null = null) {
  const insert = jest.fn().mockResolvedValue({ error })
  ;(getServiceDb as jest.Mock).mockReturnValue({ from: jest.fn(() => ({ insert })) })
  return insert
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/public/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/public/click", () => {
  const validBody = { event_type: "page_view", slug: PUBLIC_LANDING_SLUGS[0] }

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env.VERCEL_ENV
  })

  it("inserta el evento cuando VERCEL_ENV no está definido (local build/E2E)", async () => {
    const insert = mockSupabaseInsert()
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("inserta el evento en producción real (VERCEL_ENV=production)", async () => {
    process.env.VERCEL_ENV = "production"
    const insert = mockSupabaseInsert()
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("no inserta el evento en un preview deploy de Vercel (VERCEL_ENV=preview)", async () => {
    process.env.VERCEL_ENV = "preview"
    const insert = mockSupabaseInsert()
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(insert).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("no inserta el evento en un deployment de development de Vercel", async () => {
    process.env.VERCEL_ENV = "development"
    const insert = mockSupabaseInsert()
    await POST(makeRequest(validBody))
    expect(insert).not.toHaveBeenCalled()
  })
})
