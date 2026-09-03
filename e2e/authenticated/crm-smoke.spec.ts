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
  await expect(page.getByText(/Resumen general · Semana del/)).toBeVisible()
  await expect(page.getByRole("heading", { name: /seguidores en Instagram/ })).toBeVisible()
  await expect(page.getByText(/Actualizado al abrir el dashboard/).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Esta semana" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Instagram", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Publicidad", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Google", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "WhatsApp", exact: true })).toBeVisible()
  await expect(page.getByText("Publicidad en Facebook e Instagram", { exact: true })).toBeVisible()

  const contactAttemptsLink = page.getByRole("link", { name: "Ver detalle: Intentaron pedir turno" })
  await expect(contactAttemptsLink).toBeVisible()
  await contactAttemptsLink.click()
  await expect(page).toHaveURL(/period=7&detail=contacts#contact-attempts$/)
  await expect(page.getByTestId("contact-attempt-details")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Detalle de cada salida", exact: true })).toBeVisible()
  await expect(page.getByText("El detalle todavía no está disponible.")).toHaveCount(0)

  const journey = page.locator("details").filter({ hasText: "Cómo avanzan las personas hasta pedir turno" }).first()
  await expect(journey.locator("summary")).toBeVisible()
  await expect(journey.getByText("Evolución del recorrido", { exact: true })).not.toBeVisible()
  await journey.locator("summary").click()
  await expect(journey.getByText("Evolución del recorrido", { exact: true })).toBeVisible()

  const channels = page.locator("details").filter({ hasText: "Ver información detallada por canal" }).first()
  await expect(channels).toHaveAttribute("open", "")
  await expect(channels.getByText(/Vista rápida por canal/)).toBeVisible()

  const siteDetails = channels.locator("details").filter({ hasText: "Sitio y pacientes" }).first()
  await expect(siteDetails).toHaveAttribute("open", "")
  await expect(siteDetails.getByText("Consultas recientes", { exact: true })).toBeVisible()
  await expect(siteDetails.getByTestId("website-campaign-journey")).toBeVisible()
  await expect(siteDetails.getByText("Análisis avanzado del sitio", { exact: true })).toBeVisible()
  await expect(siteDetails.getByText("Prueba de los botones principales del sitio", { exact: true })).not.toBeVisible()
})

test("Configuración aclara que el WhatsApp del Hospital Británico se comparte entre sedes", async () => {
  await page.goto("/configuracion")

  await expect(page.getByRole("heading", { name: "Hospital Británico (central)", level: 3 })).toBeVisible()
  await expect(page.getByText("WhatsApp Central y Lanús", { exact: true })).toBeVisible()
})

test("la planificación reproduce agenda e ingresos del organigrama", async () => {
  await page.goto("/planificacion")

  await expect(page.getByRole("heading", { name: "Agenda e ingresos", level: 1 })).toBeVisible()
  await expect(page.getByRole("button", { name: "Todo guardado" })).toBeVisible()
  await expect(page.getByText("Editar bloques semanales", { exact: true })).toBeVisible()
  await expect(page.getByText("$ 5.564.050", { exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "Por institución" }).click()
  await expect(page.getByText("Editar aranceles y reglas", { exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: "CIMEL", exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "Proyección mensual" }).click()
  await expect(page.getByText("Configurar período y feriados", { exact: true })).toBeVisible()
  await expect(page.getByText("$ 5.795.000", { exact: true }).first()).toBeVisible()
})

test("el cronograma editorial muestra ventanas reales en horario argentino", async () => {
  await page.goto("/contenido/instagram")
  await page.getByRole("tab", { name: "Biblioteca" }).click()

  await expect(page.getByText("Entre 18:00 y 19:00 ART", { exact: true })).toBeVisible()
  await expect(page.getByText("Entre 19:00 y 20:00 ART", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Zona horaria: America/Argentina/Buenos_Aires.", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Próxima ventana estimada:/).first()).toBeVisible()
})

test("una pieza con insights muestra las ventanas históricas sin inventar faltantes", async () => {
  await page.goto("/contenido/instagram")
  await page.getByRole("tab", { name: "Biblioteca" }).click()

  const history = page.locator("details").filter({ hasText: "Evolución: 24 h · 72 h · 7 días" }).first()
  if (await history.count() === 0) return // Un entorno nuevo puede no tener publicaciones vía API todavía.

  await expect(history.locator("summary")).toBeVisible()
  await history.locator("summary").click()
  await expect(history.getByText("24 h", { exact: true })).toBeVisible()
  await expect(history.getByText("72 h", { exact: true })).toBeVisible()
  await expect(history.getByText("7 días", { exact: true })).toBeVisible()
  await expect(history.getByText(/no disponible|sin snapshot comparable/i).first()).toBeVisible()
})

test("el panel de rendimiento separa clics, conversaciones, leads y turnos", async () => {
  await page.goto("/contenido/instagram")
  await page.getByRole("tab", { name: "Rendimiento" }).click()

  await expect(page.getByText("Rendimiento y atribución", { exact: true })).toBeVisible()
  await expect(page.getByText("Un clic nunca se cuenta como conversión.", { exact: false })).toBeVisible()
  await expect(page.getByText("Conversaciones", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Leads", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Turnos confirmados", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("No disponible", { exact: true }).first()).toBeVisible()
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
