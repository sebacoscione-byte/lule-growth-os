import fs from "node:fs"
import path from "node:path"

describe("internal handoff alert template migration", () => {
  it("keeps the database language aligned with the template approved by Meta", () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260718_whatsapp_internal_alert_language.sql"),
      "utf8"
    )

    expect(migration).toContain("where name = 'alerta_interna_derivacion'")
    expect(migration).toContain("set language = 'es'")
  })
})
