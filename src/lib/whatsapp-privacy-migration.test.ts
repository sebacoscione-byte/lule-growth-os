import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_privacy_roles_retention.sql"),
  "utf8"
).replace(/\r\n/g, "\n")
const phase0bMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase0b_operations.sql"),
  "utf8"
).replace(/\r\n/g, "\n")
const phase1Migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase1_durable_transport.sql"),
  "utf8"
).replace(/\r\n/g, "\n")
const phase1dMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase1d_atomic_routing.sql"),
  "utf8"
).replace(/\r\n/g, "\n")

describe("privacy/roles/retention migration contract", () => {
  it("nace en modo compatible y toma el rol desde el claim firmado", () => {
    expect(migration).toContain("values ('global', false, false)")
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'")
    expect(migration).toContain("auth.jwt() ->> 'aal' = 'aal2'")
    expect(migration).toContain("staff_read_messages\" on messages for select to authenticated\n  using (security_role_allowed(array['owner','doctor','reception'], true))")
  })

  it("mantiene settings y auditoría fuera del cliente autenticado", () => {
    expect(migration).toContain("revoke all on table security_authorization_settings from public, anon, authenticated")
    expect(migration).toContain("revoke all on table security_audit_log from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })

  it("hace fail-closed también en RLS si falta la fila global", () => {
    expect(migration).toContain(
      "exists (select 1 from security_authorization_settings where id = 'global')"
    )
  })

  it("el borrado alcanza cola y shadow, y la limpieza es una RPC reutilizable por el cron existente", () => {
    expect(migration).toContain("delete from whatsapp_webhook_events")
    expect(migration).toContain("delete from whatsapp_policy_evaluations")
    expect(migration).toContain("delete from whatsapp_outbound_ledger")
    expect(migration).toContain("create or replace function run_whatsapp_operational_retention")
    expect(migration).toContain("delete from whatsapp_cost_events")
    expect(migration).toContain("delete from whatsapp_sessions")
    expect(migration).not.toContain("cron.schedule")
  })

  it("elimina identificadores correlacionables de consentimientos, costos y estados", () => {
    expect(migration).toContain("select wa_message_id from whatsapp_cost_events")
    expect(migration).toContain("select wa_message_id from whatsapp_outbound_ledger")
    expect(migration).toContain("set wa_id = 'erased', wa_message_id = null, outbound_ledger_key = null")
    expect(migration).toContain("set wa_id = 'erased', evidence_message_id = null")
    expect(migration).toContain("wa_id = v_phone_hash")
    expect(migration).toContain("wa_id = v_phone")
    expect(migration).toContain("set wa_id = 'expired', evidence_message_id = null")
  })

  it("no expone secretos de app_config ni su historial al cliente autenticado", () => {
    expect(migration).toContain("key = any(array['doctor','locations','whatsapp_settings','auto_publish_settings','content_pipeline'])")
    expect(migration).toContain("revoke all on table app_config_history from public, anon, authenticated")
    expect(migration).not.toContain('create policy "owner_read_app_config_history"')
    expect(migration.indexOf("create or replace function log_app_config_change"))
      .toBeLessThan(migration.indexOf("delete from app_config_history"))
  })

  it("reclama followups solo con opt-in vigente, estado elegible y sesión automática", () => {
    expect(phase0bMigration).toContain("c.purpose = 'appointment_followup'")
    expect(phase0bMigration).toContain("c.version = 'v1-appointment-followup'")
    expect(phase0bMigration).toContain("order by c.created_at desc, c.id desc")
    expect(phase0bMigration).toContain("s.state in ('handoff_pending', 'human_active', 'closed')")
    expect(phase0bMigration).toContain("p_phone !~ '^[0-9]{6,20}$'")
  })

  it("sanea teléfono y errores de las filas legacy ya finalizadas", () => {
    expect(phase1Migration).toContain("'legacy_error_redacted'")
    expect(phase1Migration).toContain("when status in ('processed', 'failed_permanent', 'dead_letter') then null")
    expect(phase1Migration).toContain("last_error = null")
  })

  it("hace idempotentes los logs por wa_message_id y reconcilia status fuera de orden", () => {
    expect(phase1Migration).toContain("messages_wa_message_id_unique unique (wa_message_id)")
    expect(phase1Migration).toContain("whatsapp_cost_events_wa_message_id_unique unique (wa_message_id)")
    expect(phase1Migration).toContain("create or replace function reconcile_whatsapp_delivery_status")
    expect(phase1Migration).toContain("least(coalesce(delivered_at, v_occurred_at), v_occurred_at)")
  })

  it("mantiene visibles y alertables las entregas ambiguas y las DLQ", () => {
    expect(phase1dMigration).toContain("create function claim_whatsapp_dead_letter_alerts")
    expect(phase1dMigration).toContain("create or replace function finalize_whatsapp_dead_letter_alert")
    expect(phase0bMigration).toContain("handoff_events_source_reason_unique")
    expect(phase0bMigration).toContain("p_source_wa_message_id text default null")
  })
})
