import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826_dashboard_site_journey.sql"),
  "utf8",
)
const locationSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826_dashboard_site_actions_by_location.sql"),
  "utf8",
)
const bookingViewSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826_landing_booking_options_view.sql"),
  "utf8",
)

describe("dashboard site journey migration", () => {
  it("counts unique anonymous sessions through the important website steps", () => {
    expect(sql).toContain("create or replace function dashboard_site_journey")
    expect(sql).toContain("count(distinct visit_key) filter (where event_type = 'page_view')")
    expect(sql).toContain("'click_hero_primary', 'click_hero_secondary'")
    expect(sql).toContain("'click_booking', 'click_call', 'click_whatsapp', 'click_maps'")
    expect(sql).toContain("timezone('America/Argentina/Buenos_Aires', created_at)::date")
  })

  it("tracks when booking options actually enter the viewport", () => {
    expect(bookingViewSql).toContain("'page_view', 'view_booking_options', 'click_booking'")
    expect(bookingViewSql).toContain("'view_booking_options', 'click_hero_primary', 'click_hero_secondary'")
    expect(bookingViewSql).toContain("revoke all on function dashboard_site_journey(date, date) from public, anon")
  })

  it("keeps the aggregate private from public and anonymous callers", () => {
    expect(sql).toContain("revoke all on function dashboard_site_journey(date, date) from public, anon")
    expect(sql).toContain("grant execute on function dashboard_site_journey(date, date) to authenticated")
  })

  it("reports every official outbound action by location", () => {
    expect(sql).toContain("create or replace function landing_clicks_by_location")
    expect(sql).toContain("event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')")
    expect(locationSql).toContain("create or replace function dashboard_site_actions_by_location")
    expect(locationSql).toContain("between least(p_start, p_end) and greatest(p_start, p_end)")
    expect(locationSql).toContain("revoke all on function dashboard_site_actions_by_location(date, date) from public, anon")
  })
})
