import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260903_dashboard_contact_metrics_clarity.sql"),
  "utf8",
)
const rankingSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260903_dashboard_landing_ranking_calendar_range.sql"),
  "utf8",
)
const channelSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260903_dashboard_weekly_channels_calendar_range.sql"),
  "utf8",
)

describe("dashboard contact metrics clarity migration", () => {
  it("defines booking intent without counting Maps as contact", () => {
    expect(sql).toContain("filter (where event_type in ('click_booking', 'click_call', 'click_whatsapp')) as engaged_visits")
    expect(sql).toMatch(/event_type in \('click_booking', 'click_call', 'click_whatsapp'\)\s*\) as contact_visits/)
    expect(sql).toContain("event_type = 'click_maps') as maps_visits")
  })

  it("uses the exact current and comparison ranges for action cards", () => {
    expect(sql).toMatch(/dashboard_action_totals\(\s*p_start date/)
    expect(sql).toContain("p_previous_start date")
    expect(sql).toContain("between least(p_start, p_end) and greatest(p_start, p_end)")
    expect(sql).toContain("between least(p_previous_start, p_previous_end) and greatest(p_previous_start, p_previous_end)")
  })

  it("keeps Maps visible as a separate outbound action", () => {
    expect(sql).toContain("event_type in ('click_booking', 'click_call', 'click_whatsapp', 'click_maps')")
    expect(sql).toContain("dashboard_action_totals(date, date, date, date)")
  })

  it("keeps every new aggregate private", () => {
    for (const signature of [
      "dashboard_action_totals(date, date, date, date)",
      "dashboard_site_journey(date, date)",
      "dashboard_campaign_performance(date, date)",
      "dashboard_content_performance(date, date)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public, anon`)
      expect(sql).toContain(`grant execute on function ${signature} to authenticated`)
    }
    expect(sql).not.toContain("phone text")
    expect(sql).not.toContain("email text")
  })

  it("aligns the landing ranking without counting Maps as booking intent", () => {
    expect(rankingSql).toContain("landing_events_ranking(p_start date, p_end date)")
    expect(rankingSql).toContain("event_type in ('click_booking', 'click_call', 'click_whatsapp')")
    expect(rankingSql).not.toContain("click_maps")
    expect(rankingSql).toContain("revoke all on function landing_events_ranking(date, date) from public, anon")
    expect(rankingSql).toContain("grant execute on function landing_events_ranking(date, date) to authenticated")
  })

  it("uses the exact visible ranges for channel performance", () => {
    expect(channelSql).toMatch(/dashboard_channel_performance\(\s*p_start date/)
    expect(channelSql).toContain("p_previous_start date")
    expect(channelSql).toContain("between least(p_start, p_end) and greatest(p_start, p_end)")
    expect(channelSql).toContain("revoke all on function dashboard_channel_performance(date, date, date, date) from public, anon")
    expect(channelSql).toContain("grant execute on function dashboard_channel_performance(date, date, date, date) to authenticated")
  })
})
