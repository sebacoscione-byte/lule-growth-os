import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260907_instagram_admin_auto_replies.sql"),
  "utf8"
).toLowerCase()

describe("instagram administrative auto reply migration", () => {
  it("mantiene la deduplicación por evento y serializa por participante", () => {
    expect(migration).toContain("where source_external_id = p_source_external_id")
    expect(migration).toContain("pg_advisory_xact_lock")
  })

  it("limita sólo respuestas iguales durante 15 minutos", () => {
    expect(migration).toContain("and reply_text = p_reply_text")
    expect(migration).toContain("interval '15 minutes'")
    expect(migration).toContain("status in ('processing', 'sent', 'indeterminate')")
  })

  it("conserva la función protegida para service_role", () => {
    expect(migration).toContain("security definer")
    expect(migration).toContain("set search_path = pg_catalog, public")
    expect(migration).toContain("from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })
})
