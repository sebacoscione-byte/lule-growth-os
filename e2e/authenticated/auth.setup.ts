import { test as setup } from "@playwright/test"
import fs from "fs"
import path from "path"

// Tiene que matchear exactamente el storageState del proyecto "authenticated" en
// playwright.config.ts ("e2e/.auth/user.json") -- __dirname acá es e2e/authenticated/, por eso
// sube un nivel con "..".
const authFile = path.join(__dirname, "../.auth/user.json")

// QA-02: usuario de prueba dedicado (ver CLAUDE.md → "Tests E2E") — nunca la cuenta real de
// Lucía/Seba. Sin estas variables configuradas, este setup se salta y escribe un storageState
// vacío (contexto sin sesión) para que la creación del browser context no rompa; cada test
// autenticado además se salta a sí mismo explícitamente (ver los .spec.ts), así que el resultado
// queda como "saltado" con motivo claro, nunca como un fallo confuso por archivo faltante.
setup("autenticar usuario de prueba E2E", async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    fs.mkdirSync(path.dirname(authFile), { recursive: true })
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }))
    setup.skip(true, "Requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD configurados — ver CLAUDE.md → Tests E2E")
    return
  }

  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Contraseña").fill(password)
  await page.getByRole("button", { name: "Ingresar" }).click()
  await page.waitForURL("/dashboard")
  await page.context().storageState({ path: authFile })
})
