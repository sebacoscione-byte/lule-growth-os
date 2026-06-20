// Migration runner for Supabase
// Usage: node scripts/migrate.mjs
// Requires SUPABASE_DB_PASSWORD in .env.local

import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local")
const envContent = readFileSync(envPath, "utf-8")
const env = Object.fromEntries(
  envContent.split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => {
      const idx = l.indexOf("=")
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
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
const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()

console.log(`Conectando a ${projectRef}...`)
await client.connect()
console.log("Conectado.\n")

// Create migration tracking table if not exists
await client.query(`
  create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`)

const { rows: applied } = await client.query("select name from _migrations")
const appliedSet = new Set(applied.map(r => r.name))

let ran = 0
for (const file of files) {
  if (appliedSet.has(file)) {
    console.log(`  ⏭  ${file} (ya aplicada)`)
    continue
  }
  const sql = readFileSync(join(migrationsDir, file), "utf-8")
  try {
    await client.query("BEGIN")
    await client.query(sql)
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file])
    await client.query("COMMIT")
    console.log(`  ✅  ${file}`)
    ran++
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(`  ❌  ${file}: ${err.message}`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log(`\n${ran === 0 ? "Todo al día — no se aplicaron migraciones nuevas." : `${ran} migración(es) aplicada(s).`}`)
