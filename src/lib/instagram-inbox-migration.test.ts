import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260905_instagram_inbox.sql"),
  "utf8"
).toLowerCase()

describe("instagram inbox migration", () => {
  it("fuerza RLS y no expone mensajes a clientes autenticados", () => {
    expect(migration).toContain("alter table public.instagram_inbox_items enable row level security")
    expect(migration).toContain("alter table public.instagram_inbox_items force row level security")
    expect(migration).toContain("revoke all on table public.instagram_inbox_items from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })

  it("limita contenido y provee retención sin crear otro cron", () => {
    expect(migration).toContain("char_length(content) <= 4096")
    expect(migration).toContain("run_instagram_inbox_retention")
    expect(migration).not.toContain("cron.schedule")
  })
})
