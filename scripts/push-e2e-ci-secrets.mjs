// Push the env vars that the "e2e" GitHub Actions workflow needs as repo secrets.
// Usage: node scripts/push-e2e-ci-secrets.mjs
// Requires: `gh` CLI authenticated with repo access, .env.local with the Supabase/E2E vars, and
// (if the test account already enrolled MFA locally) e2e/.auth/totp-secret.json.
//
// Reads values from local files and pipes each one straight into `gh secret set` without ever
// printing it — run this yourself, don't paste its output anywhere.

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const content = readFileSync(path, "utf-8")
  return Object.fromEntries(
    content.split("\n")
      .filter(l => l.includes("=") && !l.trim().startsWith("#"))
      .map(l => {
        const idx = l.indexOf("=")
        const key = l.slice(0, idx).trim()
        let value = l.slice(idx + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        return [key, value]
      })
  )
}

const env = parseEnvFile(resolve(process.cwd(), ".env.local"))

const totpFile = resolve(process.cwd(), "e2e/.auth/totp-secret.json")
let totpSecret = null
if (existsSync(totpFile)) {
  try {
    totpSecret = JSON.parse(readFileSync(totpFile, "utf-8")).secret ?? null
  } catch {
    totpSecret = null
  }
}

const secretsToPush = {
  NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  E2E_TEST_EMAIL: env.E2E_TEST_EMAIL,
  E2E_TEST_PASSWORD: env.E2E_TEST_PASSWORD,
  E2E_TEST_TOTP_SECRET: totpSecret,
}

let missing = []
let pushed = []
for (const [name, value] of Object.entries(secretsToPush)) {
  if (!value) {
    missing.push(name)
    continue
  }
  const result = spawnSync("gh", ["secret", "set", name, "--body", value], { stdio: "ignore" })
  if (result.status === 0) {
    pushed.push(name)
  } else {
    console.error(`Fallo al cargar ${name} (gh exit ${result.status})`)
  }
}

console.log(`Cargados: ${pushed.join(", ") || "ninguno"}`)
if (missing.length > 0) {
  console.log(`Faltan en .env.local / e2e/.auth/totp-secret.json: ${missing.join(", ")}`)
  if (missing.includes("E2E_TEST_TOTP_SECRET")) {
    console.log(
      "E2E_TEST_TOTP_SECRET falta porque todavía no corriste la suite autenticada localmente " +
      "(el archivo se crea solo la primera vez que e2e/authenticated pasa por el enrolamiento MFA)."
    )
  }
}
