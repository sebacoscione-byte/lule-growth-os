import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase1d_atomic_routing.sql"),
  "utf8"
).toLowerCase()

describe("WhatsApp phase 1D migration contract", () => {
  it("serializa la identidad por telefono y crea intake/links en una sola RPC", () => {
    expect(migration).toContain("create table if not exists whatsapp_lead_identities")
    expect(migration).toContain("phone_hash text primary key")
    expect(migration).toContain("select lead_id into v_lead_id\n  from whatsapp_sessions")
    expect(migration).toContain("for update")
    expect(migration).toContain("create or replace function upsert_whatsapp_intake_lead")
    expect(migration).toContain("administrative_consent_required")
    expect(migration).toContain("on conflict (wa_message_id) do nothing")
    expect(migration).toContain("update whatsapp_cost_events")
    expect(migration).toContain("update consent_records")
  })

  it("impide un envio automatico si cambio ownership/version de la sesion", () => {
    expect(migration).toContain("create or replace function authorize_whatsapp_bot_dispatch")
    expect(migration).toContain("not s.bot_paused")
    expect(migration).toContain("s.state not in ('handoff_pending', 'human_active', 'closed')")
    expect(migration).toContain("s.state_version = p_expected_state_version")
    expect(migration).toContain(
      "grant execute on function authorize_whatsapp_bot_dispatch(text, bigint) to service_role"
    )
  })

  it("vincula handoffs a un lead y elimina identificadores duplicados del summary", () => {
    expect(migration).toContain("v_lead_id := ensure_whatsapp_lead")
    expect(migration).toContain("- 'telefono' - 'nombre' - 'ultimo_mensaje'")
    expect(migration).toContain("legacy_orphan_unrecoverable")
    expect(migration).toContain("state = 'handoff_pending', bot_paused = true")
    expect(migration).not.toContain("delete from handoff_events where lead_id is null")
  })

  it("crea un caso minimo antes del scrub de un inbound en dead-letter", () => {
    expect(migration).toContain("create or replace function preserve_whatsapp_dead_letter_handoff")
    expect(migration).toContain("old.event_type = 'inbound'")
    expect(migration).toContain("'technical_code', 'inbound_event_dead_letter'")
    expect(migration).toContain("old.related_wa_message_id")
    expect(migration).toContain("before update of status on whatsapp_webhook_events")
    expect(migration).not.toContain("old.message_text")
    expect(migration).not.toContain("old.wa_name")
  })

  it("valida ledger/destino y hace unico el id global del proveedor", () => {
    expect(migration).toContain("whatsapp_outbound_ledger_wa_message_id_unique")
    expect(migration).toContain("outbound_destination_mismatch")
    expect(migration).toContain("outbound_ledger_not_found")
    expect(migration).toContain("outbound_not_ambiguous")
    expect(migration).toContain("if not found then raise exception 'whatsapp_session_not_found'")
    expect(migration).toContain("v_row.flow_step = 'internal_handoff_alert'")
  })

  it("reserva alertas DLQ y solo acredita una entrega confirmada", () => {
    expect(migration).toContain("alert_claim_token uuid")
    expect(migration).toContain("alert_claimed_at < now() - interval '15 minutes'")
    expect(migration).toContain("create or replace function finalize_whatsapp_dead_letter_alert")
    expect(migration).toContain(
      "alerted_at = case when coalesce(p_delivered, false) then now() else alerted_at end"
    )
    expect(migration).toContain(
      "grant execute on function finalize_whatsapp_dead_letter_alert(uuid, boolean) to service_role"
    )
  })
})
