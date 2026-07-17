import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717_whatsapp_handoff_inbox_retention.sql"),
  "utf8"
).replace(/\r\n/g, "\n")

describe("WhatsApp human handoff retention migration", () => {
  it("clasifica los mensajes transitorios sin cambiar los existentes", () => {
    expect(migration).toContain("add column if not exists retention_class text not null default 'standard'")
    expect(migration).toContain("retention_class in ('standard', 'handoff_transient')")
    expect(migration).toContain("where retention_class = 'handoff_transient'")
  })

  it("borra solo handoffs vencidos y limita la RPC al service role", () => {
    expect(migration).toContain("create or replace function run_whatsapp_handoff_message_retention")
    expect(migration).toContain("set search_path = pg_catalog, public")
    expect(migration).toContain("where retention_class = 'handoff_transient'")
    expect(migration).toContain("created_at < clock_timestamp() - make_interval(days => p_retention_days)")
    expect(migration).toContain("from public, anon, authenticated")
    expect(migration).toContain("to service_role")
    expect(migration).not.toContain("cron.schedule")
  })
})
