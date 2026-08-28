// Configura en Supabase pg_cron un respaldo independiente para los cinco crons de Vercel.
// Por defecto valida todo dentro de una transacción y hace rollback; --apply persiste los jobs.
// Los valores sensibles viajan como parámetros y los comandos guardados sólo referencian Vault.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"

const require = createRequire(import.meta.url)
const apply = process.argv.includes("--apply")
const urlArg = process.argv.find(argument => argument.startsWith("--url="))
const baseUrl = urlArg?.slice("--url=".length) || "https://draluciachahin.ar"
const URL_SECRET_NAME = "lule_cron_recovery_base_url"
const TOKEN_SECRET_NAME = "lule_cron_recovery_secret"

const JOBS = [
  { name: "lule-recover-daily-maintenance", schedule: "40,45,50,55 10 * * *", path: "/api/cron/daily-maintenance" },
  { name: "lule-recover-auto-draft-content", schedule: "40,45,50,55 11 * * *", path: "/api/cron/auto-draft-content" },
  { name: "lule-recover-publish-stories", schedule: "40,45,50,55 21 * * *", path: "/api/cron/publish-stories" },
  { name: "lule-recover-publish-feed", schedule: "40,45,50,55 22 * * *", path: "/api/cron/publish-feed" },
  { name: "lule-recover-weekly-report", schedule: "40,45,50,55 8 * * 0", path: "/api/cron/weekly-report" },
]

function loadLocalEnvironment() {
  const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8")
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

function validateBaseUrl(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== "https:" || parsed.hostname !== "draluciachahin.ar") {
    throw new Error("invalid_recovery_url")
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("invalid_recovery_url")
  return parsed.origin
}

async function upsertVaultSecret(client, name, value, description) {
  const { rows } = await client.query("select id from vault.secrets where name = $1 limit 1", [name])
  if (rows[0]?.id) {
    await client.query("select vault.update_secret($1::uuid, $2, $3, $4)", [rows[0].id, value, name, description])
    return "updated"
  }
  await client.query("select vault.create_secret($1, $2, $3)", [value, name, description])
  return "created"
}

function cronCommand(path) {
  return `
select net.http_get(
  url := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = '${URL_SECRET_NAME}'
    limit 1
  ) || '${path}',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = '${TOKEN_SECRET_NAME}'
      limit 1
    )
  ),
  timeout_milliseconds := 190000
) as request_id;
`.trim()
}

async function verifyPrerequisites(client) {
  const { rows: compatibilityRows } = await client.query(`
    select
      to_regprocedure('public.claim_cron_run(text,text,uuid,integer)') is not null as has_claim,
      to_regprocedure('public.complete_cron_run(text,text,uuid,text,text)') is not null as has_complete,
      exists (
        select 1
          from pg_proc procedure
          join pg_namespace namespace on namespace.oid = procedure.pronamespace
         where namespace.nspname = 'net'
           and procedure.proname = 'http_get'
           and procedure.proargnames @> array['url', 'headers', 'timeout_milliseconds']::text[]
      ) as has_compatible_http_get,
      has_table_privilege('anon', 'public.cron_run_ledger', 'select') as anon_can_read,
      has_table_privilege('authenticated', 'public.cron_run_ledger', 'select') as authenticated_can_read
  `)
  const compatibility = compatibilityRows[0]
  if (
    !compatibility?.has_claim ||
    !compatibility?.has_complete ||
    !compatibility?.has_compatible_http_get ||
    compatibility?.anon_can_read ||
    compatibility?.authenticated_can_read
  ) {
    throw new Error("cron_recovery_prerequisites_failed")
  }

  const occurrenceKey = `verification-${Date.now()}`
  const claimToken = randomUUID()
  try {
    const { rows: firstClaim } = await client.query(
      "select * from claim_cron_run($1, $2, $3::uuid, 60)",
      ["daily-maintenance", occurrenceKey, claimToken]
    )
    if (!firstClaim[0]?.claimed || firstClaim[0]?.attempts !== 1) {
      throw new Error("cron_recovery_claim_verification_failed")
    }

    const { rows: completion } = await client.query(
      "select complete_cron_run($1, $2, $3::uuid, 'succeeded', 'verification') as completed",
      ["daily-maintenance", occurrenceKey, claimToken]
    )
    if (completion[0]?.completed !== true) throw new Error("cron_recovery_completion_verification_failed")

    const { rows: duplicateClaim } = await client.query(
      "select * from claim_cron_run($1, $2, $3::uuid, 60)",
      ["daily-maintenance", occurrenceKey, randomUUID()]
    )
    if (duplicateClaim[0]?.claimed !== false || duplicateClaim[0]?.run_status !== "succeeded") {
      throw new Error("cron_recovery_deduplication_verification_failed")
    }
  } finally {
    await client.query(
      "delete from cron_run_ledger where job_name = $1 and occurrence_key = $2",
      ["daily-maintenance", occurrenceKey]
    )
  }
}

const env = loadLocalEnvironment()
const dbPassword = env.SUPABASE_DB_PASSWORD
const cronSecret = env.CRON_SECRET
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
if (!dbPassword || !supabaseUrl || !cronSecret || cronSecret.length < 24) {
  console.error("Faltan credenciales locales válidas para configurar la recuperación.")
  process.exit(1)
}

let recoveryBaseUrl
let projectRef
try {
  recoveryBaseUrl = validateBaseUrl(baseUrl)
  projectRef = new URL(supabaseUrl).hostname.split(".")[0]
} catch {
  console.error("La URL configurada para recuperación no está permitida.")
  process.exit(1)
}

let pg
try {
  pg = require("pg")
} catch {
  console.error("Falta pg. Ejecutá primero `npm run migrate -- --dry-run` para instalarlo sin guardarlo.")
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
  await client.query("begin")
  await client.query("create extension if not exists pg_net with schema extensions")
  await client.query("create extension if not exists pg_cron")
  await client.query("revoke all on table vault.secrets from public, anon, authenticated")
  await client.query("revoke all on table vault.decrypted_secrets from public, anon, authenticated")
  await verifyPrerequisites(client)

  const urlSecretAction = await upsertVaultSecret(
    client,
    URL_SECRET_NAME,
    recoveryBaseUrl,
    "Base URL pública del respaldo de crons de Lule Growth OS"
  )
  const tokenSecretAction = await upsertVaultSecret(
    client,
    TOKEN_SECRET_NAME,
    cronSecret,
    "Bearer token del respaldo de crons de Lule Growth OS"
  )

  for (const job of JOBS) {
    const { rows: existingJobs } = await client.query("select jobid from cron.job where jobname = $1", [job.name])
    for (const row of existingJobs) await client.query("select cron.unschedule($1::bigint)", [row.jobid])
    await client.query("select cron.schedule($1, $2, $3)", [job.name, job.schedule, cronCommand(job.path)])
  }

  if (apply) {
    await client.query("commit")
    console.log(`recovery_scheduler: applied; jobs=${JOBS.length}; url_secret=${urlSecretAction}; token_secret=${tokenSecretAction}`)
  } else {
    await client.query("rollback")
    console.log(`recovery_scheduler: dry_run_complete; jobs=${JOBS.length}; transaction_rolled_back=true`)
  }
} catch {
  await client.query("rollback").catch(() => undefined)
  console.error("No se pudo configurar la recuperación; se omitieron los detalles sensibles.")
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
