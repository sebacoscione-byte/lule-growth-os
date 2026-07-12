import { test, expect } from "@playwright/test"

test.describe("/login", () => {
  test("carga y muestra el formulario", async ({ page }) => {
    const response = await page.goto("/login")
    expect(response?.status()).toBe(200)
    await expect(page.getByLabel("Email")).toBeVisible()
    await expect(page.getByLabel("Contraseña")).toBeVisible()
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible()
  })

  test("no deja enviar el formulario con campos vacíos (validación HTML5)", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Ingresar" }).click()
    // Sin navegar ni mostrar el mensaje de error del servidor -- el navegador bloquea el submit
    // por los required de los inputs, así que seguimos en /login sin haber llamado a Supabase.
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText("Email o contraseña incorrectos")).not.toBeVisible()
  })

  test("muestra un error real de Supabase con credenciales inválidas", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill(`no-existe-${Date.now()}@example.com`)
    await page.getByLabel("Contraseña").fill("password-incorrecta-123")
    await page.getByRole("button", { name: "Ingresar" }).click()
    // Pega a la API real de Supabase Auth (GoTrue) -- bajo intentos repetidos en poco tiempo (ej.
    // corriendo este test varias veces seguidas) puede aplicar un throttle anti fuerza-bruta que
    // demora la respuesta bastante más que el timeout default de 5s. Timeout más generoso acá,
    // solo en esta aserción puntual, en vez de bajar la exigencia del test.
    await expect(page.getByText("Email o contraseña incorrectos")).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/login$/)
  })
})
