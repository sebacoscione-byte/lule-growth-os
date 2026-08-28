import { GET as autoDraft } from "./auto-draft-content/route"
import { GET as dailyMaintenance } from "./daily-maintenance/route"
import { GET as publishFeed } from "./publish-feed/route"
import { GET as publishStories } from "./publish-stories/route"
import { GET as weeklyReport } from "./weekly-report/route"

const ORIGINAL_ENV = process.env

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe("todos los cron routes", () => {
  it.each([
    ["auto-draft-content", autoDraft],
    ["daily-maintenance", dailyMaintenance],
    ["publish-feed", publishFeed],
    ["publish-stories", publishStories],
    ["weekly-report", weeklyReport],
  ])("%s falla cerrado sin CRON_SECRET", async (name, handler) => {
    delete process.env.CRON_SECRET
    const response = await handler(new Request(`http://localhost/api/cron/${name}`, {
      headers: { authorization: "Bearer valor-inyectado" },
    }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })
})
