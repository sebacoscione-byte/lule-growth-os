import { test, expect } from "@playwright/test"

// Slugs públicos reales (src/lib/public-landings.ts → PUBLIC_LANDING_SLUGS), listados a mano acá
// para no importar código de la app en un test E2E (corre en su propio proceso, sin el bundler de
// Next). Si se agrega una landing nueva, sumarla también acá.
const SEO_LANDING_SLUGS = [
  "cardiologa-lanus",
  "cardiologa-lomas",
  "cardiologa-caba",
  "ecocardiograma-lanus",
  "ecocardiograma-lomas",
  "consulta-cardiologica-lanus",
  "consulta-cardiologica-lomas",
]

test.describe("Landing principal (/dra-lucia-chahin)", () => {
  test("carga sin errores de consola y muestra el hero", async ({ page }) => {
    const consoleErrors: string[] = []
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    const response = await page.goto("/dra-lucia-chahin")
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { name: "Dra. Lucía Chahin", level: 1 })).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("tiene un link de llamada (tel:) y un anchor de pedir turno", async ({ page }) => {
    await page.goto("/dra-lucia-chahin")
    await expect(page.locator('a[href^="tel:"]').first()).toBeAttached()
    await expect(page.locator('a[href="#pedir-turno"]').first()).toBeAttached()
  })
})

for (const slug of SEO_LANDING_SLUGS) {
  test(`landing SEO /${slug} carga sin errores de consola`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    const response = await page.goto(`/${slug}`)
    expect(response?.status()).toBe(200)
    await expect(page.locator("h1")).toBeVisible()
    expect(consoleErrors).toEqual([])
  })
}
