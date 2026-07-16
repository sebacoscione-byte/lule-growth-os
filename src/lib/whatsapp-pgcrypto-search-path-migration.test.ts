import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migrationName = "20260716_whatsapp_security_pgcrypto_search_path.sql"
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations", migrationName),
  "utf8"
).toLowerCase()
const audit = readFileSync(
  resolve(process.cwd(), "scripts/audit-whatsapp-production.mjs"),
  "utf8"
)

const affectedSignatures = [
  "account_whatsapp_outbound_delivery(text, text)",
  "block_erased_whatsapp_contact_write()",
  "create_whatsapp_erasure_tombstone(text, text)",
  "create_whatsapp_handoff(text, uuid, text, jsonb, integer, numeric, text)",
  "ensure_whatsapp_lead_core(text, text, text, boolean, boolean, text)",
  "erase_lead(uuid, text)",
  "is_whatsapp_erasure_event_suppressed(text, text, timestamp with time zone)",
  "is_whatsapp_erasure_identifier_suppressed(text, text)",
  "quarantine_whatsapp_ambiguous_delivery(text, text, text)",
  "recover_stale_whatsapp_outbound_intents()",
  "whatsapp_erasure_identifier_hmac(text, text)",
]

describe("WhatsApp pgcrypto search_path hotfix", () => {
  it.each(affectedSignatures)("habilita pgcrypto de forma explícita en %s", signature => {
    expect(migration).toContain(`alter function public.${signature}`)
  })

  it("prioriza esquemas confiables y deja public al final", () => {
    const hardenedPaths = migration.match(
      /set search_path to pg_catalog, extensions, public;/g
    ) ?? []
    expect(hardenedPaths).toHaveLength(affectedSignatures.length)
    expect(migration).not.toMatch(/set search_path to public;/)
  })

  it("forma parte de la auditoría productiva obligatoria", () => {
    expect(audit).toContain(`"${migrationName}"`)
  })
})
