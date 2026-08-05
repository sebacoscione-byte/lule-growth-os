import { readFileSync } from "node:fs"
import { join } from "node:path"

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260805_practice_planning.sql"),
  "utf8"
)

describe("practice planning migration", () => {
  it("crea almacenamiento singleton con RLS forzado y sin delete autenticado", () => {
    expect(sql).toContain("create table if not exists practice_planning")
    expect(sql).toContain("alter table practice_planning force row level security")
    expect(sql).toContain("security_role_allowed(array['owner','doctor'], true)")
    expect(sql).toContain("grant select, insert, update on table practice_planning to authenticated")
    expect(sql).not.toContain("grant select, insert, update, delete on table practice_planning to authenticated")
  })

  it("siembra defaults sin reemplazar una configuración real", () => {
    expect(sql).toContain("on conflict (id) do nothing")
    expect(sql).not.toMatch(/on conflict \(id\) do update/i)
  })
})
