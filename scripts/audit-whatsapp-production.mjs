// Read-only operational audit for the production WhatsApp cutover.
// It deliberately prints only allowlisted flags, aggregate counts and object existence.
// Patient content, contact details, user identifiers and secret values are never emitted.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const withMetaPreflight = process.argv.includes("--with-meta")
const EXPECTED_MIGRATIONS = [
  "20260715_whatsapp_phase0a_safety.sql",
  "20260716_whatsapp_phase0b_operations.sql",
  "20260716_whatsapp_phase1_durable_transport.sql",
  "20260716_whatsapp_phase1b_outbound_ledger.sql",
  "20260716_whatsapp_phase1c_queue_checkpoint.sql",
  "20260716_whatsapp_phase1d_atomic_routing.sql",
  "20260716_whatsapp_phase1e_erasure_suppression.sql",
  "20260716_whatsapp_policy_shadow.sql",
  "20260716_whatsapp_privacy_roles_retention.sql",
  "20260716_whatsapp_security_pgcrypto_search_path.sql",
]
const EXPECTED_RELATIONS = [
  "public.whatsapp_webhook_events",
  "public.whatsapp_outbound_ledger",
  "public.whatsapp_lead_identities",
  "public.whatsapp_erasure_tombstones",
  "public.whatsapp_policy_evaluations",
  "public.security_authorization_settings",
  "public.security_audit_log",
]
const EXPECTED_FUNCTIONS = [
  "public.claim_whatsapp_webhook_event(text,integer)",
  "public.complete_whatsapp_webhook_event(uuid,text)",
  "public.claim_whatsapp_outbound_intent(text,text,text,text,text,text,text)",
  "public.erase_lead(uuid,text)",
  "public.recover_stale_whatsapp_webhook_events()",
]
const KNOWN_LOCATION_IDS = new Set([
  "cimel_lanus",
  "swiss_lomas",
  "hospital_britanico",
])
const KNOWN_ROLES = new Set(["owner", "doctor", "reception", "research", "viewer"])
const WHATSAPP_SETTINGS_DEFAULTS = {
  bot_enabled: true,
  session_ttl_hours: 24,
  shadow_mode_enabled: false,
  policy_rollout_percent: 0,
  cost_saving_mode: false,
  enable_service_message_charging: false,
  warning_message_threshold: 8,
  handoff_message_threshold: 12,
  monthly_cost_alert_ars: null,
  ai_provider: "sin_ia",
}
const WHATSAPP_AI_PROVIDERS = new Set([
  "sin_ia", "gemini", "anthropic", "openai", "otro_llm", "meta_business_agent",
])

function loadLocalEnvironment() {
  const envPath = resolve(process.cwd(), ".env.local")
  const content = readFileSync(envPath, "utf-8")
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter(line => line.includes("=") && !line.trimStart().startsWith("#"))
      .map(line => {
        const separator = line.indexOf("=")
        const key = line.slice(0, separator).trim()
        let value = line.slice(separator + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        return [key, value]
      })
  )
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : "invalid"
}

function safeInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : "invalid"
}

function getEffectiveWhatsAppSettings(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { valid: false, bot_enabled: false }
  }

  const knownKeys = new Set(Object.keys(WHATSAPP_SETTINGS_DEFAULTS))
  const candidate = { ...WHATSAPP_SETTINGS_DEFAULTS, ...stored }
  candidate.session_ttl_hours = Math.min(
    168,
    Math.max(1, Number(candidate.session_ttl_hours) || 24)
  )
  candidate.shadow_mode_enabled = false
  candidate.policy_rollout_percent = 0

  const valid = Object.keys(candidate).every(key => knownKeys.has(key))
    && typeof candidate.bot_enabled === "boolean"
    && Number.isInteger(candidate.session_ttl_hours)
    && typeof candidate.shadow_mode_enabled === "boolean"
    && Number.isInteger(candidate.policy_rollout_percent)
    && typeof candidate.cost_saving_mode === "boolean"
    && typeof candidate.enable_service_message_charging === "boolean"
    && Number.isInteger(candidate.warning_message_threshold)
    && candidate.warning_message_threshold >= 1
    && candidate.warning_message_threshold <= 100
    && Number.isInteger(candidate.handoff_message_threshold)
    && candidate.handoff_message_threshold >= 1
    && candidate.handoff_message_threshold <= 100
    && (candidate.monthly_cost_alert_ars === null
      || (typeof candidate.monthly_cost_alert_ars === "number" && candidate.monthly_cost_alert_ars >= 0))
    && WHATSAPP_AI_PROVIDERS.has(candidate.ai_provider)

  return { valid, bot_enabled: valid ? candidate.bot_enabled : false }
}

function printSection(label, value) {
  console.log(`${label}: ${JSON.stringify(value)}`)
}

function isHttpsOrEmpty(value) {
  if (value === undefined || value === null || value === "") return true
  try {
    return typeof value === "string" && new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

const env = loadLocalEnvironment()
const dbPassword = env.SUPABASE_DB_PASSWORD
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
if (!dbPassword || !supabaseUrl) {
  console.error("Faltan credenciales locales requeridas para el audit de solo lectura.")
  process.exit(1)
}

let projectRef
try {
  projectRef = new URL(supabaseUrl).hostname.split(".")[0]
} catch {
  console.error("NEXT_PUBLIC_SUPABASE_URL no tiene un formato valido.")
  process.exit(1)
}

let pg
try {
  pg = require("pg")
} catch {
  console.error("Falta pg. Ejecuta primero `npm run migrate -- --dry-run` para instalarlo sin guardarlo.")
  process.exit(1)
}

const client = new pg.Client({
  host: `db.${projectRef}.supabase.co`,
  port: 5432,
  user: "postgres",
  password: dbPassword,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  await client.query("begin read only")

  const { rows: appliedRows } = await client.query(
    "select name from public._migrations where name = any($1::text[])",
    [EXPECTED_MIGRATIONS]
  )
  const applied = new Set(appliedRows.map(row => row.name))
  printSection("migrations", {
    applied: EXPECTED_MIGRATIONS.filter(name => applied.has(name)).length,
    expected: EXPECTED_MIGRATIONS.length,
    missing: EXPECTED_MIGRATIONS.filter(name => !applied.has(name)),
  })

  const { rows: objectRows } = await client.query(
    `select
       $1::text[] as relation_names,
       array(select to_regclass(name)::text from unnest($1::text[]) as name) as relations,
       $2::text[] as function_names,
       array(select to_regprocedure(name)::text from unnest($2::text[]) as name) as functions`,
    [EXPECTED_RELATIONS, EXPECTED_FUNCTIONS]
  )
  const objectState = objectRows[0]
  printSection("schema", {
    relations: EXPECTED_RELATIONS.map((name, index) => ({
      name,
      present: objectState.relations[index] !== null,
    })),
    functions: EXPECTED_FUNCTIONS.map((name, index) => ({
      name,
      present: objectState.functions[index] !== null,
    })),
  })

  const { rows: authorizationRows } = await client.query(
    `select enforce_roles, require_mfa_for_sensitive_actions
       from public.security_authorization_settings
      where id = 'global'`
  )
  const authorization = authorizationRows[0]
  printSection("authorization", authorization ? {
    enforce_roles: authorization.enforce_roles,
    require_mfa_for_sensitive_actions: authorization.require_mfa_for_sensitive_actions,
  } : { missing: true })

  const { rows: roleRows } = await client.query(
    `with readiness as (
       select users.id,
              case
                when coalesce(users.raw_app_meta_data ->> 'role', '') = '' then 'unassigned'
                when users.raw_app_meta_data ->> 'role' = any($1::text[])
                  then users.raw_app_meta_data ->> 'role'
                else 'other'
              end as role_group,
              exists (
                select 1
                  from auth.mfa_factors factors
                 where factors.user_id = users.id and factors.status::text = 'verified'
              ) as has_verified_mfa
         from auth.users users
     )
     select role_group,
            count(*)::integer as user_count,
            count(*) filter (where has_verified_mfa)::integer as verified_mfa_count,
            count(*) filter (where not has_verified_mfa)::integer as missing_verified_mfa_count
       from readiness
      group by role_group
      order by role_group`,
    [[...KNOWN_ROLES]]
  )
  printSection("auth_roles", roleRows)

  const { rows: configRows } = await client.query(
    `select key, value
       from public.app_config
      where key = any($1::text[])`,
    [["locations", "whatsapp_settings"]]
  )
  const configs = new Map(configRows.map(row => [row.key, row.value]))
  const locations = configs.get("locations")
  printSection("locations", Array.isArray(locations)
    ? locations.map(location => ({
        id: KNOWN_LOCATION_IDS.has(location?.id) ? location.id : "unknown",
        active: location?.active === true,
        has_verified_at: typeof location?.verified_at === "string" && location.verified_at.length > 0,
        has_verified_by: typeof location?.verified_by === "string" && location.verified_by.length > 0,
        has_valid_from: typeof location?.valid_from === "string" && location.valid_from.length > 0,
        links_https_only: isHttpsOrEmpty(location?.google_maps_link)
          && isHttpsOrEmpty(location?.booking_url),
        services_count: Array.isArray(location?.services)
          ? location.services.length
          : Array.isArray(location?.practices) ? location.practices.length : 0,
      }))
    : { missing_or_invalid: true })

  const settings = configs.get("whatsapp_settings")
  const effectiveSettings = getEffectiveWhatsAppSettings(settings)
  printSection("whatsapp_settings", settings && typeof settings === "object" && !Array.isArray(settings) ? {
    present: true,
    stored_bot_enabled: settings.bot_enabled === undefined
      ? "missing_runtime_default"
      : safeBoolean(settings.bot_enabled),
    stored_shadow_mode_enabled: settings.shadow_mode_enabled === undefined
      ? "missing_runtime_default"
      : safeBoolean(settings.shadow_mode_enabled),
    stored_policy_rollout_percent: settings.policy_rollout_percent === undefined
      ? "missing_runtime_default"
      : safeInteger(settings.policy_rollout_percent, 0, 100),
    runtime_shadow_mode_enabled: false,
    runtime_policy_rollout_percent: 0,
    runtime_config_valid: effectiveSettings.valid,
    runtime_bot_enabled: effectiveSettings.bot_enabled,
  } : { present: false })

  const { rows: templateRows } = await client.query(
    `select name, status, jsonb_array_length(variables) as variable_count
       from public.templates
      where name = any($1::text[])
      order by name`,
    [["alerta_interna_derivacion", "recontacto_incompleto"]]
  )
  printSection("templates", templateRows)

  const { rows: extensionRows } = await client.query(
    `select extname
       from pg_extension
      where extname = any($1::text[])
      order by extname`,
    [["pg_cron", "pg_net", "supabase_vault", "vault"]]
  )
  printSection("scheduler_extensions", extensionRows.map(row => row.extname))

  const { rows: vaultPrivilegeRows } = await client.query(
    `select
       has_table_privilege('anon', 'vault.decrypted_secrets', 'select') as anon_can_read,
       has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') as authenticated_can_read`
  )
  printSection("vault_access", vaultPrivilegeRows[0])

  let workerSchedule = { available: false, matching_jobs: 0, active: false, schedules: [] }
  const { rows: cronSchemaRows } = await client.query("select to_regclass('cron.job') is not null as present")
  if (cronSchemaRows[0]?.present) {
    const { rows: jobRows } = await client.query(
      `select count(*)::integer as matching_jobs,
              coalesce(bool_or(active), false) as active,
              coalesce(array_agg(distinct schedule) filter (where schedule is not null), '{}') as schedules
         from cron.job
        where command like '%/api/internal/whatsapp-worker%'`
    )
    workerSchedule = { available: true, ...jobRows[0] }
  }
  printSection("worker_schedule", workerSchedule)

  let lastWorkerRun = { present: false }
  if (cronSchemaRows[0]?.present) {
    const { rows: runRows } = await client.query(
      `select details.status, details.end_time is not null as finished
         from cron.job job
         join lateral (
           select status, end_time
             from cron.job_run_details
            where jobid = job.jobid
            order by start_time desc
            limit 1
         ) details on true
        where job.jobname = 'lule-whatsapp-worker-every-minute'`
    )
    if (runRows[0]) lastWorkerRun = { present: true, ...runRows[0] }
  }
  printSection("worker_last_cron_run", lastWorkerRun)

  let recentHttpResponses = { available: false }
  const { rows: httpResponseRows } = await client.query(
    "select to_regclass('net._http_response') is not null as present"
  )
  if (httpResponseRows[0]?.present) {
    const { rows: responseSummaryRows } = await client.query(
      `select count(*)::integer as response_count,
              count(*) filter (where status_code between 200 and 299)::integer as success_count,
              count(*) filter (where timed_out or error_msg is not null)::integer as transport_error_count
         from net._http_response
        where created >= now() - interval '5 minutes'`
    )
    recentHttpResponses = { available: true, ...responseSummaryRows[0] }
  }
  printSection("recent_pg_net_responses", recentHttpResponses)

  const { rows: queueRows } = await client.query(
    `select status, count(*)::integer as event_count
       from public.whatsapp_webhook_events
      group by status
      order by status`
  )
  printSection("inbound_queue", queueRows)

  await client.query("rollback")
  console.log("audit_result: read_only_complete")
} catch {
  await client.query("rollback").catch(() => undefined)
  console.error("El audit de solo lectura fallo; se omitieron los detalles para no exponer datos.")
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}

if (withMetaPreflight && process.exitCode !== 1) {
  const allowedCodes = new Set([
    "invalid_graph_api_version",
    "missing_phone_number_id",
    "missing_access_token",
    "provider_rejected",
    "provider_unavailable",
    "invalid_provider_response",
    "phone_number_id_mismatch",
  ])
  try {
    if (!env.CRON_SECRET) throw new Error("missing_local_cron_secret")
    const response = await fetch("https://draluciachahin.ar/api/internal/whatsapp-preflight", {
      method: "GET",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({}))
    const result = {
      status: response.status,
      ok: payload?.ok === true,
      code: payload?.code === null
        ? null
        : allowedCodes.has(payload?.code) ? payload.code : "unexpected_response",
    }
    printSection("meta_preflight", result)
    if (!response.ok || !result.ok) process.exitCode = 1
  } catch {
    printSection("meta_preflight", { status: null, ok: false, code: "request_failed" })
    process.exitCode = 1
  }
}
