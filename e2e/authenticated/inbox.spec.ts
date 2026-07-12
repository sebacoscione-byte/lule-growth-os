import { test, expect } from "@playwright/test"

// QA-02: requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD (ver CLAUDE.md → Tests E2E). No se verificó
// corriendo en este entorno (sin credenciales de prueba disponibles).
test.skip(!process.env.E2E_TEST_EMAIL, "Requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD — ver CLAUDE.md → Tests E2E")

test("abrir una conversación del inbox", async ({ page }) => {
  await page.goto("/inbox")
  await expect(page.getByRole("heading", { name: "Inbox", level: 2 })).toBeVisible()

  // El inbox depende de que ya existan leads reales en la base del entorno de prueba — si está
  // vacío, se verifica el estado vacío en vez de fallar (no hay control sobre los datos de
  // prueba desde acá).
  const firstLead = page.locator("aside button").first()
  if (await firstLead.count() === 0) {
    await expect(page.getByText("Sin leads todavía")).toBeVisible()
    return
  }

  await firstLead.click()
  await expect(page.getByText("Seleccioná un lead para ver la conversación")).not.toBeVisible()
})
