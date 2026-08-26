import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("migración del correo profesional", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260826_doctor_professional_email.sql"),
    "utf8"
  )

  it("agrega solo la clave email sin reemplazar el objeto doctor", () => {
    expect(sql).toMatch(/jsonb_set\s*\(/i)
    expect(sql).toContain("'{email}'")
    expect(sql).toContain("draluciachahin@gmail.com")
    expect(sql).not.toMatch(/set\s+value\s*=\s*'\{/i)
  })
})
