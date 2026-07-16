// Idempotent Supabase Cron/Vault setup for the durable WhatsApp worker.
// Default mode validates all SQL in a rolled-back transaction. Pass --apply to persist it.
// Secret values are sent as bind parameters and are never printed or embedded in cron.job.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const apply = process.argv.includes("--apply")
const urlArg = process.argv.find(argument => argument.startsWith("--url="))
const baseUrl = urlArg?.slice("--url=".length) || "https://draluciachahin.ar"
const JOB_NAME = "lule-whatsapp-worker-every-minute"
const URL_SECRET_NAME = "lule_whatsapp_worker_base_url"
const TOKEN_SECRET_NAME = "lule_whatsapp_worker_cron_secret"

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
    throw new Error("invalid_worker_url")
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("invalid_worker_url")
  }
  return parsed.origin
}

async function upsertVaultSecret(client, name, value, description) {
  const { rows } = await client.query(
    "select id from vault.secrets where name = $1 limit 1",
    [name]
  )
  if (rows[0]?.id) {
    await client.query(
      "select vault.update_secret($1::uuid, $2, $3, $4)",
      [rows[0].id, value, name, description]
    )
    return "updated"
  }
  await client.query(
    "select vault.create_secret($1, $2, $3)",
    [value, name, description]
  )
  return "created"
}

const env = loadLocalEnvironment()
const dbPassword = env.SUPABASE_DB_PASSWORD
const cronSecret = env.CRON_SECRET
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
if (!dbPassword || !supabaseUrl || !cronSecret || cronSecret.length < 24) {
  console.error("Faltan credenciales locales validas para configurar el worker.")
  process.exit(1)
}

let workerBaseUrl
let projectRef
try {
  workerBaseUrl = validateBaseUrl(baseUrl)
  projectRef = new URL(supabaseUrl).hostname.split(".")[0]
} catch {
  console.error("La URL configurada para el worker no esta permitida.")
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

const cronCommand = `
select net.http_post(
  url := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = '${URL_SECRET_NAME}'
    limit 1
  ) || '/api/internal/whatsapp-worker',
  body := '{}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = '${TOKEN_SECRET_NAME}'
      limit 1
    )
  ),
  timeout_milliseconds := 50000
) as request_id;
`.trim()

try {
  await client.connect()
  await client.query("begin")
  await client.query("create extension if not exists pg_net with schema extensions")
  await client.query("create extension if not exists pg_cron")

  await client.query("revoke all on table vault.secrets from public, anon, authenticated")
  await client.query("revoke all on table vault.decrypted_secrets from public, anon, authenticated")

  const urlSecretAction = await upsertVaultSecret(
    client,
    URL_SECRET_NAME,
    workerBaseUrl,
    "Base URL publica del worker durable de WhatsApp"
  )
  const tokenSecretAction = await upsertVaultSecret(
    client,
    TOKEN_SECRET_NAME,
    cronSecret,
    "Bearer token del worker durable de WhatsApp"
  )

  const { rows: existingJobs } = await client.query(
    "select jobid from cron.job where jobname = $1",
    [JOB_NAME]
  )
  for (const row of existingJobs) {
    await client.query("select cron.unschedule($1::bigint)", [row.jobid])
  }
  await client.query(
    "select cron.schedule($1, $2, $3)",
    [JOB_NAME, "* * * * *", cronCommand]
  )

  if (apply) {
    await client.query("commit")
    console.log(`scheduler: applied; url_secret=${urlSecretAction}; token_secret=${tokenSecretAction}`)
  } else {
    await client.query("rollback")
    console.log("scheduler: dry_run_complete; transaction_rolled_back=true")
  }
} catch {
  await client.query("rollback").catch(() => undefined)
  console.error("No se pudo configurar el scheduler; se omitieron los detalles sensibles.")
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}

if (apply && process.exitCode !== 1) {
  try {
    const response = await fetch(`${workerBaseUrl}/api/internal/whatsapp-worker`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(55_000),
    })
    const payload = response.ok ? await response.json().catch(() => ({})) : {}
    const safeResult = response.ok ? {
      claimed: Number(payload.claimed) || 0,
      processed: Number(payload.processed) || 0,
      retried: Number(payload.retried) || 0,
      deadLettered: Number(payload.deadLettered) || 0,
    } : null
    console.log(`worker_endpoint: status=${response.status}; result=${JSON.stringify(safeResult)}`)
    if (!response.ok) process.exitCode = 1
  } catch {
    console.error("El scheduler quedo aplicado, pero fallo la verificacion HTTP sin exponer detalles.")
    process.exitCode = 1
  }
}
