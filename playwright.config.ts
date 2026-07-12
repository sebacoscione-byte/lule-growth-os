import { defineConfig, devices } from "@playwright/test"

// QA-02 (docs/BACKLOG.md): smoke E2E. "public" corre sin sesión y se puede verificar de punta a
// punta en cualquier entorno. "authenticated" depende de un usuario de prueba dedicado
// (E2E_TEST_EMAIL/E2E_TEST_PASSWORD, ver CLAUDE.md) — sin esas variables, auth.setup.ts se salta
// solo y los tests que dependen de sesión se saltan con ellos (no fallan en rojo por falta de
// credenciales).
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
    { name: "auth-setup", testDir: "./e2e/authenticated", testMatch: /auth\.setup\.ts/ },
    {
      name: "authenticated",
      testDir: "./e2e/authenticated",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
    },
  ],
  // Sin webServer automático a propósito: en este entorno el dev server ya suele estar corriendo
  // aparte (ver run-lule-growth-os skill) y arrancar uno nuevo acá pisaría ese puerto. Levantar
  // `npm run dev` (o `npm run build && npm run start`) antes de `npm run test:e2e`.
})
