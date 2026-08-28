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
const recoverySchedulerScript = readFileSync(
  resolve(process.cwd(), "scripts/configure-cron-recovery.mjs"),
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

  it("keeps the frequent WhatsApp worker on Supabase instead of Vercel", () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"))
    // Desde enero de 2026 Hobby admite 100 jobs por proyecto; el worker frecuente sigue afuera
    // porque Hobby solo permite una ejecución diaria por job.
    expect(vercel.crons.length).toBeLessThanOrEqual(100)
    expect(vercel.crons).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/internal/whatsapp-worker" }),
      ]),
    )
  })

  it("backs up every Vercel cron through Vault without embedding credentials", () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"))
    for (const cron of vercel.crons) {
      expect(recoverySchedulerScript).toContain(cron.path)
    }
    expect(recoverySchedulerScript).toContain("vault.create_secret($1, $2, $3)")
    expect(recoverySchedulerScript).toContain("vault.update_secret($1::uuid, $2, $3, $4)")
    expect(recoverySchedulerScript).toContain("vault.decrypted_secrets")
    expect(recoverySchedulerScript).not.toContain("${cronSecret}")
    expect(recoverySchedulerScript).toContain('process.argv.includes("--apply")')
    expect(recoverySchedulerScript).toContain('process.argv.includes("--verify-only")')
    expect(recoverySchedulerScript).toContain("verifyScheduledJobs")
    expect(recoverySchedulerScript).toContain("whatsapp_worker_preserved=true")
    expect(recoverySchedulerScript).toContain('await client.query("rollback")')
  })
})
