import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase1e_erasure_suppression.sql"),
  "utf8"
).toLowerCase()
const privacy = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_privacy_roles_retention.sql"),
  "utf8"
).toLowerCase()
const policyShadow = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_policy_shadow.sql"),
  "utf8"
).toLowerCase()

describe("WhatsApp phase 1E erasure contract", () => {
  it("no almacena identificadores crudos y separa ventana concurrente de redelivery", () => {
    expect(migration).toContain("secret bytea not null")
    expect(migration).toContain("hmac(")
    expect(migration).toContain("whatsapp_erasure_secret_unavailable")
    expect(migration).toContain("kind in ('phone', 'event', 'outbound')")
    expect(migration).toContain("v_expiry := now() + interval '90 days'")
    expect(migration).toContain("is_whatsapp_erasure_event_suppressed")
    expect(migration).toContain("p_occurred_at <= t.erased_at")
    const tableDefinitions = migration.match(/create table[^;]+/g)?.join("\n") ?? ""
    expect(tableDefinitions).not.toMatch(/\bphone\s+text/)
  })

  it("bloquea enqueue, lead/session, evidencia y claim de salida", () => {
    expect(migration).toContain("before insert on whatsapp_webhook_events")
    expect(migration).toContain("new.related_wa_message_id")
    expect(migration).toContain("pg_advisory_xact_lock")
    expect(migration).toContain("before insert or update of phone on leads")
    expect(migration).toContain("before insert or update of phone on whatsapp_sessions")
    expect(migration).toContain("unnest(array[v_old_phone, v_new_phone])")
    expect(migration).toContain("order by phone")
    expect(migration).toContain("block_erased_whatsapp_evidence_write")
    expect(migration).toContain("block_erased_whatsapp_status_evidence")
    expect(migration).toContain("block_erased_whatsapp_hash_write")
    expect(migration).toContain("block_erased_whatsapp_lease_hash")
    expect(migration).toContain("whatsapp_policy_evaluations is created by the later policy-shadow migration")
    expect(migration).not.toContain("drop trigger if exists block_erased_whatsapp_policy_hash")
    expect(policyShadow).toContain("drop trigger if exists block_erased_whatsapp_policy_hash")
    expect(policyShadow).toContain("execute function block_erased_whatsapp_hash_write()")
    expect(migration).toContain("return query select 'suppressed'::text")
    expect(migration).toContain("is_whatsapp_erasure_identifier_suppressed('outbound', p_dedupe_key)")
    expect(migration).toContain("create or replace function ensure_whatsapp_lead")
    expect(migration).toContain("raise exception 'whatsapp_erasure_suppressed'")
  })

  it("permite completar idempotentemente una fila ya eliminada sin DLQ/handoff", () => {
    expect(migration).toContain("create or replace function complete_erased_whatsapp_webhook_event")
    expect(migration).toContain("erasure_tombstone_required")
    expect(migration).toContain("erasure_event_identity_mismatch")
    expect(migration).toContain("v_event.wa_message_id is distinct from p_source_key")
    expect(migration).toContain("p_related_source_key")
    expect(migration).toContain("delete from whatsapp_webhook_events")
    expect(migration).toContain("return true")
  })

  it("crea tombstones antes de borrar y limpia sólo los vencidos por retención", () => {
    const tombstoneAt = privacy.indexOf("create_whatsapp_erasure_tombstone('phone', v_phone)")
    const queueDeleteAt = privacy.indexOf("delete from whatsapp_webhook_events")
    expect(tombstoneAt).toBeGreaterThan(-1)
    expect(tombstoneAt).toBeLessThan(queueDeleteAt)
    expect(privacy).toContain("create_whatsapp_erasure_tombstone('event', v_identifier)")
    expect(privacy).toContain("create_whatsapp_erasure_tombstone('outbound', v_identifier)")
    expect(privacy).toContain("select related_wa_message_id from whatsapp_webhook_events")
    expect(privacy).toContain("whatsapp_erasure_dispatch_in_flight")
    expect(privacy).toContain("select phone into v_phone from leads where id = p_lead_id for update")
    expect(privacy).toContain("delete from whatsapp_erasure_tombstones where expires_at <= now()")
    expect(privacy).toContain("if v_phone ~ '^[0-9]{6,20}$' then")
  })
})
