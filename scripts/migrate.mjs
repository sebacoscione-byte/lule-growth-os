// Migration runner for Supabase
// Usage: node scripts/migrate.mjs [--dry-run] [--atomic] [--from=<migration.sql>]
// --dry-run validates every selected pending migration in one transaction and rolls it back.
// --atomic applies every selected pending migration in one transaction or rolls all of them back.
// --from limits the operation to that migration and every lexicographically later file.
// Requires SUPABASE_DB_PASSWORD in .env.local

import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const dryRun = process.argv.includes("--dry-run")
const atomic = dryRun || process.argv.includes("--atomic")
const fromArg = process.argv.find(arg => arg.startsWith("--from="))
const fromFile = fromArg?.slice("--from=".length) || null

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local")
const envContent = readFileSync(envPath, "utf-8")
const env = Object.fromEntries(
  envContent.split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=")
      const key = l.slice(0, idx).trim()
      let value = l.slice(idx + 1).trim()
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
      return [key, value]
    })
)

const dbPassword = env.SUPABASE_DB_PASSWORD
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]

if (!dbPassword) {
  console.error("❌  SUPABASE_DB_PASSWORD no está en .env.local")
  console.error(`   Encontralo en: https://supabase.com/dashboard/project/${projectRef}/settings/database`)
  console.error("   Copia el campo 'Password' y agregalo al .env.local")
  process.exit(1)
}

let pg
try {
  pg = require("pg")
} catch {
  console.error("❌  Instala pg: npm install --no-save pg")
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

const migrationsDir = resolve(process.cwd(), "supabase/migrations")
const allFiles = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()
if (fromFile && !allFiles.includes(fromFile)) {
  console.error("❌  La migración indicada en --from no existe")
  process.exit(1)
}
const files = fromFile ? allFiles.filter(file => file >= fromFile) : allFiles

console.log(`Conectando a ${projectRef}${dryRun ? " para validación con rollback" : ""}...`)
await client.connect()
console.log("Conectado.\n")

let ran = 0
let currentFile = null

try {
  if (atomic) await client.query("BEGIN")

  // Create migration tracking table if not exists. In dry-run mode this is also rolled back.
  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows: applied } = await client.query("select name from _migrations")
  const appliedSet = new Set(applied.map(r => r.name))

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  ⏭  ${file} (ya aplicada)`)
      continue
    }

    currentFile = file
    const sql = readFileSync(join(migrationsDir, file), "utf-8")

    if (!atomic) await client.query("BEGIN")
    try {
      await client.query(sql)
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file])
      if (!atomic) await client.query("COMMIT")
      console.log(`  ${dryRun ? "🔎" : atomic ? "🧩" : "✅"}  ${file}`)
      ran++
    } catch (err) {
      if (!atomic) await client.query("ROLLBACK")
      throw err
    }
  }

  if (dryRun) {
    await client.query("ROLLBACK")
    console.log(`\n${ran === 0 ? "Todo al día — no había migraciones para validar." : `${ran} migración(es) validadas; rollback completo.`}`)
  } else if (atomic) {
    await client.query("COMMIT")
    console.log(`\n${ran === 0 ? "Todo al día — no se aplicaron migraciones nuevas." : `${ran} migración(es) aplicadas en una única transacción.`}`)
  } else {
    console.log(`\n${ran === 0 ? "Todo al día — no se aplicaron migraciones nuevas." : `${ran} migración(es) aplicada(s).`}`)
  }
} catch (err) {
  if (atomic) await client.query("ROLLBACK").catch(() => undefined)
  console.error(`  ❌  ${currentFile ?? "preparación"}: ${err.message}`)
  await client.end()
  process.exit(1)
}

await client.end()
