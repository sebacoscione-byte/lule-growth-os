jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }))
jest.mock("@/lib/ai", () => ({ generateFollowupMessage: jest.fn() }))

import { createClient } from "@/lib/supabase/server"
import { generateFollowupMessage } from "@/lib/ai"
import { POST } from "./route"

describe("POST /api/followup", () => {
  beforeEach(() => jest.clearAllMocks())

  it("bloquea el camino legacy para WhatsApp y no simula un envío", async () => {
    const messageInsert = jest.fn()
    const client = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "staff-1" } } }) },
      from: jest.fn((table: string) => {
        if (table === "leads") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: "lead-1",
                    origin_channel: "whatsapp",
                    preferred_location: "cimel_lanus",
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === "messages") return { insert: messageInsert }
        throw new Error(`tabla inesperada: ${table}`)
      }),
    }
    ;(createClient as jest.Mock).mockResolvedValue(client)

    const response = await POST(new Request("http://localhost/api/followup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "lead-1" }),
    }))

    expect(response.status).toBe(409)
    expect(generateFollowupMessage).not.toHaveBeenCalled()
    expect(messageInsert).not.toHaveBeenCalled()
  })
})
