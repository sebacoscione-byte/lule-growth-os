import { test, expect } from "@playwright/test"

// QA-02: requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD (ver CLAUDE.md → Tests E2E). No se verificó
// corriendo en este entorno (sin credenciales de prueba disponibles) — escrito a partir de la
// lectura del código real (leads/nuevo/page.tsx, lead-status-editor.tsx, leads/page.tsx), pero la
// primera corrida real queda pendiente de confirmar antes de dar QA-02 por completo terminado.
test.skip(!process.env.E2E_TEST_EMAIL, "Requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD — ver CLAUDE.md → Tests E2E")

// Prefijo para poder identificar y limpiar manualmente datos de prueba si el test se corta antes
// de llegar al borrado (ver "Eliminar datos de este paciente" en /leads/[id]).
const TEST_LEAD_NAME = `E2E TEST — no borrar a mano si el test sigue corriendo — ${Date.now()}`

test("crear, editar y buscar un lead", async ({ page }) => {
  // Crear (leads/page.tsx no tiene un buscador propio hoy, solo filtros de estado por link —
  // "buscar" se verifica navegando a /leads?q=... directamente).
  await page.goto("/leads/nuevo")
  await page.getByPlaceholder("Nombre completo").fill(TEST_LEAD_NAME)
  await page.getByPlaceholder("+54 11...").fill("1122334455")
  await page.getByRole("button", { name: "Guardar lead" }).click()
  await page.waitForURL(/\/leads\/[a-f0-9-]+$/)

  // Editar: cambiar el estado a "Calificado" con el selector de la card "Estado".
  await page.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "Calificado" }).click()
  await expect(page.getByText("Calificado").first()).toBeVisible()

  // Buscar: el lead recién creado tiene que aparecer al filtrar /leads por su nombre.
  await page.goto(`/leads?q=${encodeURIComponent(TEST_LEAD_NAME)}`)
  await expect(page.getByText(TEST_LEAD_NAME)).toBeVisible()

  // Limpieza: borrar el lead de prueba para no dejar datos falsos en la base real. El botón usa
  // window.confirm() nativo (lead-erase-action.tsx), no un segundo botón en el DOM — hay que
  // aceptar el diálogo del navegador, si no Playwright lo descarta solo por default.
  await page.goto(`/leads?q=${encodeURIComponent(TEST_LEAD_NAME)}`)
  await page.getByText(TEST_LEAD_NAME).first().click()
  await page.waitForURL(/\/leads\/[a-f0-9-]+$/)
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: /Eliminar datos de este paciente/i }).click()
  await page.waitForURL("/leads")
})
