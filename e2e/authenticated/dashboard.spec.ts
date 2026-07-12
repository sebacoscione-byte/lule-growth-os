import { test, expect } from "@playwright/test"

// QA-02: requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD (ver CLAUDE.md → Tests E2E). Sin esas
// variables, auth.setup.ts no genera una sesión real y este test se salta explícitamente — no
// se verificó corriendo en este entorno (sin credenciales de prueba disponibles).
test.skip(!process.env.E2E_TEST_EMAIL, "Requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD — ver CLAUDE.md → Tests E2E")

test("un usuario autorizado puede entrar al dashboard", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
})
