import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911_remove_pami_coverage.sql"),
  "utf8"
).toLowerCase()

describe("PAMI coverage removal migration", () => {
  it("removes every PAMI label from the shared locations config", () => {
    expect(migration).toContain("update public.app_config")
    expect(migration).toContain("where key = 'locations'")
    expect(migration).toContain("not like 'pami%'")
  })

  it("preserves coverage and location ordering", () => {
    expect(migration).toContain("jsonb_agg(coverage order by coverage_ordinal)")
    expect(migration).toContain("order by location_ordinal")
  })
})
