import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const importer = readFileSync(resolve(process.cwd(), "scripts/import-instagram-export.mjs"), "utf8")

describe("Instagram export importer", () => {
  it("no imprime textos o identidades y no importa adjuntos binarios", () => {
    expect(importer).toContain("console.log(JSON.stringify({ files: files.length, imported: rows.length }))")
    expect(importer).not.toContain("console.log(rows)")
    expect(importer).not.toContain("readFileSync(message")
    expect(importer).toContain("attachment_type")
  })

  it("genera claves idempotentes y vencimiento de 90 días", () => {
    expect(importer).toContain("onConflict: \"external_id\"")
    expect(importer).toContain("90 * 24 * 60 * 60 * 1000")
  })
})
