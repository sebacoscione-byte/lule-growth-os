import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const auditScript = readFileSync(
  resolve(process.cwd(), "scripts/audit-whatsapp-production.mjs"),
  "utf8",
)
const schedulerScript = readFileSync(
  resolve(process.cwd(), "scripts/configure-whatsapp-worker.mjs"),
  "utf8",
)

describe("WhatsApp production operation scripts", () => {
  it("keeps the production audit read-only and aggregate-only", () => {
    expect(auditScript).toContain('await client.query("begin read only")')
    expect(auditScript).toContain('console.log("audit_result: read_only_complete")')
    expect(auditScript).not.toMatch(
      /select\s+(?:\*|decrypted_secret)\s+from\s+vault\.decrypted_secrets/i,
    )
    expect(auditScript).not.toMatch(/console\.log\([^\n]*(?:dbPassword|cronSecret|env\.)/)
  })

  it("stores scheduler credentials through bind parameters and Vault references", () => {
    expect(schedulerScript).toContain("vault.create_secret($1, $2, $3)")
    expect(schedulerScript).toContain("vault.update_secret($1::uuid, $2, $3, $4)")
    expect(schedulerScript).toContain(
      "revoke all on table vault.decrypted_secrets from public, anon, authenticated",
    )

    const cronCommand = schedulerScript.slice(
      schedulerScript.indexOf("const cronCommand"),
      schedulerScript.indexOf("try {", schedulerScript.indexOf("const cronCommand")),
    )
    expect(cronCommand).toContain("vault.decrypted_secrets")
    expect(cronCommand).toContain("TOKEN_SECRET_NAME")
    expect(cronCommand).not.toContain("${cronSecret}")
  })

  it("defaults to rollback and requires an explicit apply flag", () => {
    expect(schedulerScript).toContain('process.argv.includes("--apply")')
    expect(schedulerScript).toContain('await client.query("rollback")')
    expect(schedulerScript).toContain("transaction_rolled_back=true")
  })

  it("does not consume a third Vercel cron slot", () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"))
    expect(vercel.crons).toHaveLength(2)
    expect(vercel.crons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/internal/whatsapp-worker" }),
      ]),
    )
  })
})
