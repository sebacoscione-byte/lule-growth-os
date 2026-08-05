import { readFileSync } from "fs"
import { resolve } from "path"

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260805_instagram_content_attribution.sql"), "utf8")
const timestampSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260805_instagram_content_attribution_timestamp.sql"), "utf8")
const backfillSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260805_instagram_content_attribution_legacy_backfill.sql"), "utf8")
const conversationSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260805_instagram_content_conversation_history.sql"), "utf8")

describe("migración de atribución de contenido", () => {
  it("separa pieza, referencia y sede sin guardar contenido del paciente", () => {
    expect(sql).toMatch(/whatsapp_sessions add column if not exists content_item_id text/i)
    expect(sql).toMatch(/leads add column if not exists referral_code text/i)
    expect(sql).toMatch(/content_origin_location_key/i)
    expect(sql).toMatch(/p_utm_content:?[\s\S]*p_referral_code/i)
  })

  it("mantiene una RPC v2 cerrada a service_role y exige consentimiento", () => {
    expect(sql).toMatch(/function upsert_whatsapp_intake_lead_v2/i)
    expect(sql).toMatch(/administrative_consent_required/i)
    expect(sql).toMatch(/revoke all on function upsert_whatsapp_intake_lead_v2[\s\S]*from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function upsert_whatsapp_intake_lead_v2[\s\S]*to service_role/i)
  })

  it("agrega sólo etapas comprobables y recomendaciones de lectura autenticada", () => {
    expect(sql).toMatch(/function instagram_content_attribution/i)
    expect(sql).toMatch(/event_type = 'click_whatsapp'/i)
    expect(sql).toMatch(/count\(distinct s\.id\) as conversations/i)
    expect(sql).toMatch(/count\(\*\) filter \(where l\.confirmed_booked\) as confirmed/i)
    expect(sql).toMatch(/authenticated_read_instagram_strategy_recommendations/i)
  })

  it("fija el primer instante atribuible sin moverlo con cada mensaje", () => {
    expect(timestampSql).toMatch(/add column if not exists content_attributed_at timestamptz/i)
    expect(timestampSql).toMatch(/s\.content_attributed_at >= p_since/i)
    expect(timestampSql).not.toMatch(/s\.updated_at >= p_since/i)
  })

  it("preserva los códigos históricos antes de reutilizar utm_content para la pieza", () => {
    expect(backfillSql).toMatch(/set referral_code = upper\(trim\(utm_content\)\)/i)
    expect(backfillSql).toMatch(/utm_content ~\*/i)
  })

  it("conserva historial de conversaciones sin copiar teléfono ni texto", () => {
    expect(conversationSql).toMatch(/create table if not exists instagram_content_conversations/i)
    expect(conversationSql).toMatch(/unique \(whatsapp_session_id, content_item_id\)/i)
    expect(conversationSql).toMatch(/create trigger capture_instagram_content_conversation_trigger/i)
    expect(conversationSql).toMatch(/from instagram_content_conversations c/i)
    expect(conversationSql).not.toMatch(/\bphone text\b|\bmessage text\b|\bcontent text\b/i)
    expect(conversationSql).toMatch(/security definer[\s\S]*set search_path = public/i)
    expect(conversationSql).toMatch(/revoke all on function instagram_content_attribution[\s\S]*from public, anon/i)
  })
})
