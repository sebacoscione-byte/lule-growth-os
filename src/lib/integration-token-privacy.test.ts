jest.mock("@/lib/supabase/service", () => ({ getServiceDb: jest.fn() }))

import { getServiceDb } from "@/lib/supabase/service"
import {
  getConnectionInfo as getGoogleConnectionInfo,
  saveTokens as saveGoogleTokens,
} from "@/lib/google-business"
import { getConnectionInfo as getInstagramConnectionInfo } from "@/lib/instagram-business"

function readDb(rows: Array<{ key: string; value: string }>) {
  const builder: Record<string, jest.Mock> = {}
  builder.select = jest.fn(() => builder)
  builder.in = jest.fn().mockResolvedValue({ data: rows, error: null })
  return { from: jest.fn(() => builder) }
}

describe("privacidad de credenciales de integraciones", () => {
  beforeEach(() => jest.clearAllMocks())

  it("Google usa el token para determinar conexión pero nunca lo devuelve al caller", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue(readDb([
      { key: "google_refresh_token", value: "refresh-secret" },
      { key: "google_account_id", value: "account-1" },
      { key: "google_location_id", value: "location-1" },
    ]))
    const info = await getGoogleConnectionInfo({} as never)
    expect(info).toEqual(expect.objectContaining({
      google_account_id: "account-1",
      google_location_id: "location-1",
    }))
    expect(JSON.stringify(info)).not.toContain("refresh-secret")
    expect(info).not.toHaveProperty("google_refresh_token")
  })

  it("Instagram no expone el access token en la metadata de conexión", async () => {
    ;(getServiceDb as jest.Mock).mockReturnValue(readDb([
      { key: "instagram_access_token", value: "access-secret" },
      { key: "instagram_user_id", value: "ig-1" },
      { key: "instagram_username", value: "lucia" },
    ]))
    const info = await getInstagramConnectionInfo({} as never)
    expect(info).toEqual({ instagram_user_id: "ig-1", instagram_username: "lucia" })
    expect(JSON.stringify(info)).not.toContain("access-secret")
    expect(info).not.toHaveProperty("instagram_access_token")
  })

  it("falla cerrado si una escritura de tokens no queda persistida", async () => {
    let write = 0
    ;(getServiceDb as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        upsert: jest.fn().mockImplementation(async () => ({
          error: write++ === 1 ? { message: "database detail" } : null,
        })),
      })),
    })
    await expect(saveGoogleTokens({} as never, {
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
    })).rejects.toThrow("google_token_storage_failed")
  })
})
