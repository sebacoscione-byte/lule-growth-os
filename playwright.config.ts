import { defineConfig, devices } from "@playwright/test"

// QA-02 (docs/BACKLOG.md): smoke E2E. "public" corre sin sesión y se puede verificar de punta a
// punta en cualquier entorno. "authenticated" depende de un usuario de prueba dedicado
// (E2E_TEST_EMAIL/E2E_TEST_PASSWORD, ver CLAUDE.md) — sin esas variables, crm-smoke.spec.ts se
// salta solo (no falla en rojo por falta de credenciales).
//
// Los tests autenticados viven en un único archivo (`crm-smoke.spec.ts`) con
// `test.describe.configure({ mode: "serial" })` y un solo login compartido: la cuenta de prueba
// solo admite una sesión activa a la vez (Supabase invalida la sesión vieja si se loguea de nuevo
// mientras la anterior sigue en pie -- se manifestaba como `session_not_found` al crear un
// challenge de MFA concurrente cuando dashboard/inbox/leads vivían en archivos separados, cada uno
// con su propio login, corriendo en paralelo).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "public", testDir: "./e2e/public", use: { ...devices["Desktop Chrome"] } },
    { name: "authenticated", testDir: "./e2e/authenticated", use: { ...devices["Desktop Chrome"] } },
  ],
  // Sin webServer automático a propósito: en este entorno el dev server ya suele estar corriendo
  // aparte (ver run-lule-growth-os skill) y arrancar uno nuevo acá pisaría ese puerto. Levantar
  // `npm run dev` (o `npm run build && npm run start`) antes de `npm run test:e2e`.
})
