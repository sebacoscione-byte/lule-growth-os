import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260828_cron_run_ledger.sql"),
  "utf8",
)

describe("cron recovery migration", () => {
  it("mantiene el ledger fuera del navegador", () => {
    expect(migration).toContain("alter table cron_run_ledger force row level security")
    expect(migration).toContain("revoke all on table cron_run_ledger from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })

  it("reclama por tarea y ocurrencia con lease y fencing token", () => {
    expect(migration).toContain("primary key (job_name, occurrence_key)")
    expect(migration).toContain("claim_token = p_claim_token")
    expect(migration).toContain("lease_until < now()")
    expect(migration).toContain("cron_run_ledger.status = 'failed'")
  })

  it("no permite reintentar estados terminales exitosos o con advertencia", () => {
    const conflictClause = migration.slice(
      migration.indexOf("on conflict (job_name, occurrence_key) do update"),
      migration.indexOf("returning true", migration.indexOf("on conflict (job_name, occurrence_key) do update")),
    )
    expect(conflictClause).not.toContain("cron_run_ledger.status = 'succeeded'")
    expect(conflictClause).not.toContain("cron_run_ledger.status = 'warning'")
  })
})
