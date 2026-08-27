import {
  getFollowerCount,
  getInstagramAccountInsights,
  getValidToken,
} from "@/lib/instagram-business"
import { getLiveInstagramAccountMetrics } from "@/lib/instagram-followers"

jest.mock("@/lib/instagram-business", () => ({
  getFollowerCount: jest.fn(),
  getInstagramAccountInsights: jest.fn(),
  getValidToken: jest.fn(),
}))

describe("live Instagram account metrics", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("reads current followers and account activity without exposing the token", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue("secret-never-log")
    ;(getFollowerCount as jest.Mock).mockResolvedValue(221)
    ;(getInstagramAccountInsights as jest.Mock).mockResolvedValue({
      reach: 40,
      profileViews: 12,
      linkTaps: 2,
      totalInteractions: 8,
    })

    const result = await getLiveInstagramAccountMetrics(
      {} as never,
      new Date("2026-08-27T17:00:00.000Z"),
    )

    expect(result).toEqual({
      followersCount: 221,
      reach: 40,
      profileViews: 12,
      linkTaps: 2,
      totalInteractions: 8,
      fetchedAt: "2026-08-27T17:00:00.000Z",
    })
    expect(JSON.stringify(result)).not.toContain("secret-never-log")
  })

  it("returns null while Instagram is disconnected", async () => {
    ;(getValidToken as jest.Mock).mockResolvedValue(null)

    await expect(getLiveInstagramAccountMetrics({} as never)).resolves.toBeNull()
    expect(getFollowerCount).not.toHaveBeenCalled()
  })
})
