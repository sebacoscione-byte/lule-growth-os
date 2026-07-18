import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260718_locations_particular_capability.sql"),
  "utf8"
)

describe("migración de atención particular por sede", () => {
  it("deriva el booleano desde el valor legacy y elimina Particular de coberturas", () => {
    expect(migration).toContain("'accepts_particular'")
    expect(migration).toContain("lower(trim(coverage)) <> 'particular'")
    expect(migration).toContain("lower(trim(coverage)) = 'particular'")
    expect(migration).toContain("where key = 'locations'")
  })
})
