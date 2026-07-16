import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { evaluateWhatsAppPolicy } from "./whatsapp-policy"
import { buildWhatsAppPolicyShadowRecord } from "./whatsapp-policy-shadow"

const EVENT_HASH = "a".repeat(64)
const CONVERSATION_HASH = "b".repeat(64)

describe("registro shadow sin PII", () => {
  it("guarda solo comparaciones cerradas y hashes", () => {
    const candidate = evaluateWhatsAppPolicy({ state: "routed", input_type: "text", text: "Hola" })
    const record = buildWhatsAppPolicyShadowRecord({
      event_hash: EVENT_HASH,
      conversation_hash: CONVERSATION_HASH,
      initial_state: "routed",
      input_type: "text",
      legacy: {
        action: "continue",
        intent: "greeting",
        response_key: "greeting_existing",
        handoff: false,
      },
      candidate,
      rollout_bucket: 7,
      served_by: "legacy",
    })

    expect(record).toMatchObject({
      event_hash: EVENT_HASH,
      conversation_hash: CONVERSATION_HASH,
      action_match: true,
      intent_match: true,
      response_match: true,
      handoff_match: true,
    })
    expect(record).not.toHaveProperty("text")
    expect(record).not.toHaveProperty("phone")
    expect(record).not.toHaveProperty("name")
  })

  it("rechaza identificadores reversibles", () => {
    const candidate = evaluateWhatsAppPolicy({ state: "routed", input_type: "text", text: "Hola" })
    expect(() => buildWhatsAppPolicyShadowRecord({
      event_hash: "wamid.example",
      conversation_hash: "5491112345678",
      initial_state: "routed",
      input_type: "text",
      legacy: {
        action: "continue",
        intent: "greeting",
        response_key: "greeting_existing",
        handoff: false,
      },
      candidate,
      rollout_bucket: 7,
      served_by: "legacy",
    })).toThrow()
  })

  it("la migración fuerza RLS y no agrega columnas de texto o teléfono", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260716_whatsapp_policy_shadow.sql"),
      "utf8",
    ).toLowerCase()
    expect(sql).toContain("force row level security")
    expect(sql).toContain("to service_role")
    expect(sql).toContain("revoke all on table whatsapp_policy_evaluations from public, anon, authenticated")
    expect(sql).not.toMatch(/\b(phone|user_text|message_text|patient_name)\s+(text|varchar)/)
  })
})
