import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826_dashboard_campaign_performance.sql"),
  "utf8",
)

describe("dashboard campaign performance migration", () => {
  it("agrega el embudo por campaña con dimensiones UTM completas", () => {
    expect(sql).toContain("create or replace function dashboard_campaign_performance")
    expect(sql).toContain("utm_source")
    expect(sql).toContain("utm_medium")
    expect(sql).toContain("utm_campaign")
    expect(sql).toContain("utm_content")
    expect(sql).toContain("click_booking")
    expect(sql).toContain("confirmed_booked")
  })

  it("expone solamente agregados al personal autenticado", () => {
    expect(sql).toContain("revoke all on function dashboard_campaign_performance(int) from public, anon")
    expect(sql).toContain("grant execute on function dashboard_campaign_performance(int) to authenticated")
    expect(sql).not.toContain("phone")
    expect(sql).not.toContain("email")
    expect(sql).not.toContain("general_reason")
  })
})
