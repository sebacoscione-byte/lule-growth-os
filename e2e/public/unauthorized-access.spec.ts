import { test, expect } from "@playwright/test"

// Verifica el auth gate de src/proxy.ts sin necesitar sesión real: cualquier ruta del CRM tiene
// que redirigir a /login para un visitante anónimo. Mismo chequeo que ya se hacía a mano con curl
// durante TECH-01/SEO-01 (ver docs/BACKLOG.md), ahora como test automatizado.
const PROTECTED_ROUTES = ["/dashboard", "/leads", "/inbox", "/contenido/instagram", "/google-local", "/configuracion", "/seguridad/mfa"]

for (const route of PROTECTED_ROUTES) {
  test(`${route} redirige a /login sin sesión`, async ({ page }) => {
    await page.goto(route)
    await expect(page).toHaveURL(/\/login/)
  })
}
