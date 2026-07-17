import { test, expect, type Page } from "@playwright/test"
import { loginAsTestUser } from "./login-helper"

// QA-02: requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD (ver CLAUDE.md → Tests E2E).
test.skip(!process.env.E2E_TEST_EMAIL, "Requiere E2E_TEST_EMAIL/E2E_TEST_PASSWORD — ver CLAUDE.md → Tests E2E")

// Un solo login compartido para toda la suite autenticada, reusando la misma `page` en los tres
// tests: la cuenta de prueba solo admite una sesión activa a la vez (Supabase invalida la sesión
// vieja si se loguea de nuevo mientras la anterior sigue en pie -- se manifestaba como
// `session_not_found` al crear un challenge de MFA concurrente). dashboard/inbox/leads vivían antes
// en archivos separados, cada uno con su propio login independiente; correrlos en paralelo
// disparaba justo esa condición. Consolidados acá con `mode: "serial"` para que corran uno detrás
// del otro sobre la misma sesión, como lo haría una persona real navegando el CRM.
test.describe.configure({ mode: "serial" })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await loginAsTestUser(page)
})

test.afterAll(async () => {
  await page.close()
})

test("un usuario autorizado puede entrar al dashboard", async () => {
  await page.goto("/dashboard")
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
})

test("abrir una conversación del inbox", async () => {
  await page.goto("/inbox")
  const inboxHeading = page.getByRole("heading", { name: "Inbox", level: 2 })
  await expect(inboxHeading).toBeVisible()

  // El sidebar de toda la app también es un <aside> con su propio botón "Cerrar sesión" -- un
  // `aside button` sin acotar matcheaba ESE botón (el primero en el DOM), no un lead, y cerraba la
  // sesión sin que el test lo notara. Acá se acota al <aside> que contiene el heading "Inbox".
  const inboxList = page.locator("aside").filter({ has: inboxHeading })

  // El inbox depende de que ya existan leads reales en la base del entorno de prueba — si está
  // vacío, se verifica el estado vacío en vez de fallar (no hay control sobre los datos de
  // prueba desde acá).
  const firstLead = inboxList.locator("button").first()
  if (await firstLead.count() === 0) {
    await expect(page.getByText("Sin leads todavía")).toBeVisible()
    return
  }

  await firstLead.click()
  await expect(page.getByText("Seleccioná un lead para ver la conversación")).not.toBeVisible()
})

test("crear, editar y buscar un lead", async () => {
  // Prefijo para poder identificar y limpiar manualmente datos de prueba si el test se corta antes
  // de llegar al borrado (ver "Eliminar datos de este paciente" en /leads/[id]).
  const runId = Date.now()
  const testLeadName = `E2E TEST — no borrar a mano si el test sigue corriendo — ${runId}`
  // Teléfono único por corrida, no fijo: borrar un lead (DATA-02) deja un tombstone HMAC del
  // teléfono y `POST /api/leads` lo rechaza con 500 `whatsapp_erasure_suppressed` si se reusa un
  // número recién borrado -- con un número fijo, correr este test varias veces seguidas terminaba
  // chocando contra su propio borrado anterior.
  const testPhone = `11${String(runId).slice(-8)}`

  // Crear (leads/page.tsx no tiene un buscador propio hoy, solo filtros de estado por link —
  // "buscar" se verifica navegando a /leads?q=... directamente).
  await page.goto("/leads/nuevo")
  await page.getByPlaceholder("Nombre completo").fill(testLeadName)
  await page.getByPlaceholder("+54 11...").fill(testPhone)
  await page.getByRole("button", { name: "Guardar lead" }).click()
  await page.waitForURL(/\/leads\/[a-f0-9-]+$/)

  // Editar: cambiar el estado a "Calificado" con el selector de la card "Estado".
  await page.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "Calificado" }).click()
  await expect(page.getByText("Calificado").first()).toBeVisible()

  // Buscar: el lead recién creado tiene que aparecer al filtrar /leads por su nombre. La vista
  // renderiza tarjeta mobile + fila desktop en simultáneo (responsive) -- la tarjeta mobile queda
  // oculta por CSS al viewport de escritorio que usa este proyecto, así que un `.first()` a ciegas
  // podía matchear justo la copia oculta. Se acota a la fila de la tabla desktop, la que sí es
  // visible acá.
  await page.goto(`/leads?q=${encodeURIComponent(testLeadName)}`)
  const desktopRow = page.getByRole("table").getByText(testLeadName)
  await expect(desktopRow).toBeVisible()

  // Limpieza: borrar el lead de prueba para no dejar datos falsos en la base real. El nombre en la
  // tabla es texto plano (no navega) -- lo que navega es el botón "Ver" de esa misma fila. El botón
  // de borrado usa window.confirm() nativo (lead-erase-action.tsx), no un segundo botón en el DOM —
  // hay que aceptar el diálogo del navegador, si no Playwright lo descarta solo por default.
  await page.goto(`/leads?q=${encodeURIComponent(testLeadName)}`)
  await page.getByRole("row", { name: new RegExp(testLeadName) }).getByRole("link", { name: "Ver" }).click()
  await page.waitForURL(/\/leads\/[a-f0-9-]+$/)
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: /Eliminar datos de este paciente/i }).click()
  await page.waitForURL("/leads")
})
