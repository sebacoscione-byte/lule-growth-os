import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_phase1c_queue_checkpoint.sql"),
  "utf8"
).toLowerCase()
const checkpointFunction = migration.slice(
  migration.indexOf("create or replace function checkpoint_whatsapp_webhook_handler"),
  migration.indexOf("create or replace function recover_stale_whatsapp_webhook_events")
)

describe("WhatsApp phase 1C migration contract", () => {
  it("exige un checkpoint durable antes de cerrar un evento", () => {
    expect(migration).toContain("add column if not exists handler_completed_at timestamptz")
    expect(migration).toContain("create or replace function checkpoint_whatsapp_webhook_handler")
    expect(migration).toContain("handler_completed_at = coalesce(handler_completed_at, now())")
    expect(migration).toContain("and locked_by = p_worker_id")
    expect(migration).toContain("and handler_completed_at is not null")
    expect(migration).toContain("grant execute on function checkpoint_whatsapp_webhook_handler(uuid, text) to service_role")
  })

  it("el checkpoint elimina inmediatamente el envelope sensible que el ACK-only retry no usa", () => {
    for (const column of [
      "phone",
      "message_text",
      "wa_name",
      "button_id",
      "referral",
      "status_error_code",
    ]) {
      expect(checkpointFunction).toContain(`${column} = null`)
    }
  })

  it("prioriza retries de ACK sobre el límite de intentos y reserva DLQ para handlers incompletos", () => {
    expect(migration).toContain("create or replace function claim_whatsapp_webhook_event")
    expect(migration).toContain("when handler_completed_at is not null then 'retry'")
    expect(migration).toContain(
      "phone = case when handler_completed_at is null and attempts >= 5 then null else phone end"
    )
    expect(migration).toContain(
      "attempts = case when handler_completed_at is null then attempts + 1 else attempts end"
    )
    expect(migration).toContain("v_dead_letter := v_event.handler_completed_at is null")
    expect(migration).toContain("grant execute on function claim_whatsapp_webhook_event(text, integer) to service_role")
    expect(migration).toContain(
      "grant execute on function fail_whatsapp_webhook_event(uuid, text, text, boolean, integer) to service_role"
    )
  })

  it("aplica la misma prioridad del checkpoint en el recuperador invocable por Supabase Cron", () => {
    expect(migration).toContain("create or replace function recover_stale_whatsapp_webhook_events()")
    expect(migration).toContain("when handler_completed_at is not null then 'retry'")
    expect(migration).toContain(
      "message_text = case when handler_completed_at is null and attempts >= 5 then null else message_text end"
    )
    expect(migration).toContain(
      "grant execute on function recover_stale_whatsapp_webhook_events() to service_role"
    )
  })

  it("convierte followups estancados en ambiguos mediante la transición atómica existente", () => {
    expect(migration).toContain("create or replace function recover_stale_whatsapp_followups()")
    expect(migration).toContain("whatsapp_followup_status = 'dispatching'")
    expect(migration).toContain("now() - interval '15 minutes'")
    expect(migration).toContain("for update skip locked")
    expect(migration).toContain("complete_whatsapp_followup(v_lead_id, 'ambiguous', now())")
    expect(migration).toContain("grant execute on function recover_stale_whatsapp_followups() to service_role")
  })
})
