import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260906_instagram_booking_auto_reply.sql"),
  "utf8"
).toLowerCase()

describe("instagram booking auto reply migration", () => {
  it("protege configuración y ledger con RLS forzado", () => {
    expect(migration).toContain("alter table public.instagram_auto_reply_settings force row level security")
    expect(migration).toContain("alter table public.instagram_auto_replies force row level security")
    expect(migration).toContain("revoke all on table public.instagram_auto_replies from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })

  it("deduplica por evento y limita una respuesta por persona durante 24 horas", () => {
    expect(migration).toContain("source_external_id text not null unique")
    expect(migration).toContain("pg_advisory_xact_lock")
    expect(migration).toContain("interval '24 hours'")
    expect(migration).toContain("status in ('processing', 'sent', 'indeterminate')")
  })

  it("reutiliza la retención existente sin agregar un cron", () => {
    expect(migration).toContain("create or replace function public.run_instagram_inbox_retention")
    expect(migration).toContain("delete from public.instagram_auto_replies")
    expect(migration).not.toContain("cron.schedule")
  })
})
