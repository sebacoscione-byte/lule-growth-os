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
  "ecocardiograma-caba",
  "consulta-cardiologica-lanus",
  "consulta-cardiologica-lomas",
  "consulta-cardiologica-caba",
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

  test("muestra las opciones concretas de turno antes del contenido institucional", async ({ page }) => {
    await page.goto("/dra-lucia-chahin")
    const booking = page.getByRole("heading", { name: "Pedir turno", level: 2 })
    const about = page.getByRole("heading", { name: "Sobre la Dra. Lucía Chahin", level: 2 })
    await expect(booking).toBeVisible()
    expect(await booking.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await about.elementHandle())).toBe(true)
  })

  test("comparte el WhatsApp oficial entre Hospital Británico Lanús y Central", async ({ page }) => {
    await page.goto("/dra-lucia-chahin")
    const lanusWhatsApp = page.locator('#sede-britanico-lanus a[href^="https://wa.me/"]')
    const centralWhatsApp = page.locator('#sede-britanico-central a[href^="https://wa.me/"]')

    await expect(lanusWhatsApp).toBeAttached()
    await expect(centralWhatsApp).toBeAttached()
    expect(await lanusWhatsApp.getAttribute("href")).toBe(await centralWhatsApp.getAttribute("href"))
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
