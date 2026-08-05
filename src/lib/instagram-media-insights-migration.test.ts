import { readFileSync } from "fs"
import { resolve } from "path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260804_instagram_media_insight_snapshots.sql"),
  "utf8"
)

describe("migración de historial de insights de Instagram", () => {
  it("hace idempotente cada media por día argentino", () => {
    expect(migration).toMatch(/unique index[\s\S]*instagram_media_id, capture_date/i)
  })

  it("mantiene métricas opcionales y raw JSON sin defaults numéricos", () => {
    for (const column of [
      "reach", "views", "likes", "comments", "saved", "shares", "follows", "profile_visits",
      "total_watch_time_ms", "average_watch_time_ms", "reels_skip_rate",
    ]) {
      expect(migration).toMatch(new RegExp(`\\n\\s*${column} (bigint|numeric),`))
    }
    expect(migration).toContain("raw_metrics_json jsonb not null default '{}'::jsonb")
  })

  it("solo permite escritura al service role y lectura autenticada", () => {
    expect(migration).toMatch(/for all to service_role/i)
    expect(migration).toMatch(/for select to authenticated/i)
  })

  it("fija una referencia histórica de published_at sin sobrescribir una existente", () => {
    expect(migration).toContain("coalesce(item->>'published_at', '') = ''")
    expect(migration).toContain("manual_publish_note,marked_at")
  })
})
