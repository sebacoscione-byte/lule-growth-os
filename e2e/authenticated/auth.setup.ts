import { test as setup, type Page } from "@playwright/test"
import fs from "fs"
import path from "path"
import * as OTPAuth from "otpauth"

// Tiene que matchear exactamente el storageState del proyecto "authenticated" en
// playwright.config.ts ("e2e/.auth/user.json") -- __dirname acá es e2e/authenticated/, por eso
// sube un nivel con "..".
const authFile = path.join(__dirname, "../.auth/user.json")

// Secreto TOTP de la cuenta de prueba, persistido localmente entre corridas (gitignored, ver
// .gitignore → "/e2e/.auth/"). Nunca en .env.local: es un artefacto de test, no una credencial que
// cargue una persona. Si el factor real en Supabase se pierde/recrea, este archivo queda obsoleto y
// el flujo de abajo vuelve a enrolar uno nuevo solo.
const totpSecretFile = path.join(__dirname, "../.auth/totp-secret.json")

function currentTotpCode(base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(base32Secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  })
  return totp.generate()
}

function readStoredTotpSecret(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(totpSecretFile, "utf-8"))
    return typeof raw.secret === "string" ? raw.secret : null
  } catch {
    return null
  }
}

function writeStoredTotpSecret(secret: string): void {
  fs.mkdirSync(path.dirname(totpSecretFile), { recursive: true })
  fs.writeFileSync(totpSecretFile, JSON.stringify({ secret }))
}

/**
 * Desde el hardening del 2026-07-16, `require_mfa_for_sensitive_actions` fuerza a cualquier cuenta
 * a pasar por /seguridad/mfa antes de ver el resto del CRM. Esta cuenta de prueba no tiene forma de
 * escanear un QR con un celular, así que resuelve el TOTP por código: en la primera corrida enrola
 * un factor nuevo y guarda el secreto localmente; en corridas siguientes, si el factor ya quedó
 * verificado, solo hace el paso de verificación (challenge) con un código fresco.
 */
async function resolveMfaGate(page: Page): Promise<void> {
  const challengeInput = page.locator("#challenge-code")
  const enrollButton = page.getByRole("button", { name: "Generar código QR" })

  await Promise.race([
    challengeInput.waitFor({ state: "visible", timeout: 15000 }),
    enrollButton.waitFor({ state: "visible", timeout: 15000 }),
  ])

  if (await challengeInput.isVisible()) {
    const storedSecret = readStoredTotpSecret()
    if (!storedSecret) {
      throw new Error(
        "La cuenta ya tiene un factor MFA verificado en Supabase, pero no hay ningún secreto " +
        "guardado en e2e/.auth/totp-secret.json para generar el código. Borrá el factor en " +
        "Supabase (Auth → Users) o restaurá el archivo de una corrida anterior."
      )
    }
    await challengeInput.fill(currentTotpCode(storedSecret))
    await page.getByRole("button", { name: "Verificar" }).click()
    return
  }

  await enrollButton.click()
  const secretLocator = page.locator("code")
  await secretLocator.waitFor({ state: "visible", timeout: 15000 })
  const secretCode = (await secretLocator.innerText()).trim()

  await page.locator("#enrollment-code").fill(currentTotpCode(secretCode))
  await page.getByRole("button", { name: "Activar y verificar" }).click()
  writeStoredTotpSecret(secretCode)
}

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

  // Ojo: justo después de loguearse hay un flash transitorio del router client-side a /dashboard
  // ANTES de que el layout server-side redirija a /seguridad/mfa si corresponde -- esperar por URL
  // agarra ese estado intermedio equivocado. Se espera por contenido real en su lugar.
  const dashboardHeading = page.getByRole("heading", { name: "Dashboard", level: 1 })
  const mfaHeading = page.getByRole("heading", { name: "Seguridad de la cuenta", level: 1 })
  await Promise.race([
    dashboardHeading.waitFor({ state: "visible", timeout: 15000 }),
    mfaHeading.waitFor({ state: "visible", timeout: 15000 }),
  ])

  if (await mfaHeading.isVisible()) {
    await resolveMfaGate(page)
    await page.waitForURL("/dashboard")
  }

  await page.context().storageState({ path: authFile })
})
