# Backlog — Lule Growth OS
**Actualizado:** 2026-07-17 | **Basado en:** PRD Estrategia de Captación v2.1

---

## Inbox — handoff humano y móvil (2026-07-17)

- [x] Separar handoff pendiente de conversación tomada usando `taken_at`; una conversación tomada ya
  no muestra ni dispara recordatorios de “esperando a una persona”.
- [x] Señalar “Paciente respondió” cuando el último movimiento posterior a la toma es entrante y
  quitar la señal después de la siguiente respuesta manual.
- [x] Al reactivar el bot, enviar un aviso administrativo fijo al paciente. No usa IA; si la ventana
  de Meta está cerrada o el proveedor no confirma el envío, el Inbox lo informa sin revertir la
  reactivación ya completada.
- [x] Mantener visibles los mensajes recibidos después de que el equipo toma una conversación,
  incluso si contienen una consulta clínica espontánea o el consentimiento administrativo anterior
  no es vigente. Sólo se conservan 30 días, con acceso de staff+MFA, sin IA ni respuesta automática.
- [x] Ejecutar el borrado dentro de la barrida semanal existente; no se agrega un tercer cron.
- [x] Apilar nombre/estado y acciones en móvil, con botones en dos columnas y texto multilínea.
- [ ] Validar con asesoría legal el fundamento y plazo de esta retención transitoria.

---

## Bot de WhatsApp — producción activa y gates externos (2026-07-16)

El hardening derivado de `Investigacion_y_plan_bot_WhatsApp_Dra_Lucia_Chahin_para_Claude.md` y de
los 180 casos del CSV está activo en producción. El PR #96 fue mergeado (`dcc0e47`), las nueve
migraciones iniciales se aplicaron atómicamente y el re-run no encontró pendientes. El hotfix
`whatsapp_security_pgcrypto_search_path` elevó el estado productivo a 10/10 migraciones. CI, Vercel producción,
el smoke público y el rechazo esperado del webhook inválido quedaron verdes. El PR #97 también
fue mergeado (`d9434d7`) y dejó productivos el scheduler, el audit agregado y el preflight cerrado
de Meta.

- [x] **Cutover médico/técnico:** detector, textos fijos y límites clínicos integrados con la pausa
  excepcional correspondiente. La IA no redacta respuestas para pacientes; sólo devuelve enums.
- [ ] **Revisión legal:** validar consentimiento por finalidad, texto de privacidad, proveedores y
  transferencia internacional, oposición/borrado, primer mensaje pre-consentimiento y plazos de
  retención, incluido `data_erasure_log`.
- [x] **Migraciones productivas:** 0A → 0B → 1 → 1B → 1C → 1D → 1E → policy → privacy →
  pgcrypto-search-path aplicadas con `--atomic`; el audit informó 10/10.
- [x] **Compatibilidad SQL real:** el dry-run con rollback y la aplicación persistente terminaron
  correctamente sobre el esquema de producción.
- [ ] **Staging de concurrencia:** disponer de una base clonada, inspeccionar duplicados históricos
  de identidad/IDs de Meta que 1D reconcilia y probar interleavings reales entre cola, outbox,
  handoff y borrado. La ejecución productiva valida SQL y dependencias, no esas carreras temporales.
  **Decisión (2026-07-18): pausado a propósito, atado a la decisión ya pendiente de pagar Supabase
  Pro** (ver "🤔 Decisiones tuyas" más arriba) — Pro incluye branching (bases efímeras clonadas de
  producción), que resuelve esto sin crear ni mantener un proyecto de staging aparte. Este Windows
  tampoco tiene Docker/WSL2 instalados (alternativa gratis vía `supabase start` local, descartada
  por ahora al elegir esperar Pro). Retomar cuando definas el plan de Supabase.
- [x] **Recuperación frecuente activa:** un único job de `pg_cron`,
  `lule-whatsapp-worker-every-minute`, corre con schedule `* * * * *` y usa `pg_net` para llamar a
  `POST /api/internal/whatsapp-worker`. URL y `CRON_SECRET` están cifrados en Supabase Vault; la
  llamada manual autenticada respondió 200 con la cola vacía y la ejecución automática posterior
  terminó correctamente con HTTP 2xx.
- [x] **Accesos:** `owner` y `doctor` tienen `app_metadata.role` y MFA verificado. Las otras dos
  cuentas quedan deliberadamente sin rol y bloqueadas. Se activó primero `enforce_roles`, se auditó,
  y después `require_mfa_for_sensitive_actions`; ambos quedaron en `true`.
- [x] **Flujo MFA en producto:** enrolamiento y step-up TOTP,
  administración de múltiples factores, gate central del CRM, callback seguro y autorización de
  rutas internas completados técnicamente. Al activar el flag, todo el CRM exige AAL2 porque RLS
  protege también las lecturas de PII.
- [x] **Enrolamiento y recuperación MFA:** ambas cuentas operativas tienen TOTP verificado. El
  `owner` decidió no agregar un segundo autenticador; se acepta el riesgo de recuperación
  administrativa. Sin endpoint público: validar identidad fuera de banda, eliminar el factor por
  Supabase Admin/Dashboard y reenrolar, sin copiar secretos ni PII a logs o tickets.
- [x] **Verificación individual de sedes:** UI/API con evidencia,
  control de versión y escritura atómica por sede completadas; una edición ya no verifica a las
  otras ubicaciones.
- [x] **Confirmar sedes reales:** CIMEL Lanús, Hospital Británico y Swiss Medical Lomas están
  activas y tienen evidencia individual vigente. El runtime falla cerrado si una futura versión
  pierde esa evidencia.
- [x] **Preflight de Meta:** Vercel Production fija `META_GRAPH_API_VERSION=v25.0`; un GET read-only
  valida versión, token e ID sin enviar mensajes ni devolver credenciales/identificadores. El cron
  diario alerta por email con códigos cerrados si deja de funcionar.
- [x] ~~**Template interno de Meta:** falta que Meta apruebe `alerta_interna_derivacion`~~
  **Resuelto (2026-07-17)** — Meta lo aprobó, Seba lo marcó "Aprobado" en Configuración →
  Templates de WhatsApp, verificado en la base (`status: "aprobado"`). `ALERT_WHATSAPP_TO` ya
  estaba configurado como sensible en Vercel Production — la alerta interna por WhatsApp ante una
  derivación a humano ya puede mandarse de verdad, no solo por email.
- [x] **Deploy y smoke:** PR #96 mergeado (`dcc0e47`), CI/Vercel producción verdes y smoke público
  más caso negativo del webhook aprobados. PR #97 mergeado (`d9434d7`) y scheduler/preflight/audit
  verificados en producción.

Estado técnico productivo: contención Fase 0 y transporte durable Fase 1 activos; scaffolding de
Fases 2/3 permanece apagado y Fases 4/5 no se habilitaron. El outbox evita reintentos automáticos
ciegos, pero no promete entrega externa exactamente una vez porque Meta no expone una clave de
idempotencia.

Dentro de Fase 1, **1C** separa “handler completado” del ACK final para que un retry no vuelva a
responder; **1D** hace atómicos identidad/routing/handoff y aplica CAS antes del envío; **1E**
coordina borrado con workers/outbox y mantiene tombstones HMAC. El teléfono se tombstonea 90 días,
pero el bloqueo genérico dura 15 minutos; un redelivery viejo sigue bloqueado según `occurred_at`.

Esta implementación supersede las descripciones históricas WA-02/WA-03 y Ola 4 que aparecen más
abajo: ya no existe `whatsapp-idempotency.ts`, el webhook no usa `500` como cola de reintento, el
umbral de presión no es `>=140` y el mensaje pre-consentimiento no se persiste ni reutiliza. Se usa
persist-before-ACK + worker/leases/DLQ/outbox y el guardrail actual evalúa `>180`/`>120` con contexto.

---

## 📌 Pendientes tuyos (2026-07-12)

Todo lo técnico que se podía resolver sin vos ya está resuelto. Esto es lo que queda — agrupado
por qué tipo de acción es, para que sepas qué esperar de cada uno. El detalle completo de cada
ítem está más abajo, en la sección que corresponda.

### 🚨 Lo más importante — bloquea que el bot hable con pacientes reales
- [ ] **Resolver el rechazo de la verificación de negocio de Meta.** Mientras siga rechazada, el
  bot de WhatsApp probablemente solo puede conversar con números agregados como tester en el Meta
  Developer Console — no con pacientes reales. Hay que revisar qué dato no cruzó bien contra AFIP
  antes de volver a mandar documentos (ver Etapa 7 más abajo).

### ⚖️ Revisión legal (dato de salud)
- [ ] Mandarle `docs/REVISION_LEGAL_PRIVACIDAD.md` a un abogado — ya tiene **7 preguntas
  concretas** redactadas y listas para copiar/pegar (DATA-01/03): terceros, transferencia
  internacional de datos, acuerdos de tratamiento de datos (DPA) con los proveedores, plazos de
  retención, consentimiento de analítica, si el texto de consentimiento de WhatsApp alcanza como
  consentimiento informado, y si hace falta un tratamiento especial para menores de edad (hoy no
  hay ninguno — laguna real, no decisión tomada a propósito).
  - **(2026-07-18)** El material ya está redactado como email completo, listo para pegar y mandar
    — se intentó crear un borrador directo en Gmail pero el conector estaba desconectado (token
    vencido). Reconectalo en la configuración de conectores de claude.ai y pedile a un agente que
    lo reintente, o simplemente copiá el texto vos (armado en la sesión del 2026-07-18) y armá el
    mail a mano con el mail del abogado.

### 🔑 Trámites en cuentas externas (Meta/Google) que solo vos podés hacer
- [ ] **2FA del Business Manager**: Facebook te bloqueó activarlo en tu cuenta personal ("no
  usaste mucho tiempo este dispositivo"). Probá desde la app de Facebook en el celular (más
  historial de uso), o esperá 24-48hs y reintentá.
- [x] **Activar el respaldo de IA del bot de WhatsApp** ✅ Resuelto (2026-07-15) — `ai_provider:
  "gemini"` activado (migración `20260715_enable_whatsapp_ai_fallback.sql`), `GEMINI_MODEL`/
  `DAILY_AI_REQUEST_LIMIT` cargados en `.env.local` y en Vercel producción (con redeploy). En el
  camino se encontraron y corrigieron dos bugs reales que hubieran dejado esto sin efecto: (1)
  `GEMINI_MODEL` en Vercel tenía cargada una API key en vez de un nombre de modelo (corregido a
  mano por Seba en el dashboard); (2) `classifyWhatsAppIntent()` pedía `maxTokens: 20`, insuficiente
  para el modo JSON de Gemini (siempre cortaba la respuesta a mitad de camino) — corregido a `60`,
  verificado en vivo contra la API real. Ver CLAUDE.md → entrada 2026-07-15 para el detalle completo.
- [x] ~~**Reaprobar el template `alerta_interna_derivacion`**~~ **Resuelto (2026-07-17)** — Meta
  aprobó la versión genérica de una sola variable (`CASO-…`, sin nombre ni motivo del paciente).
  Marcado "Aprobado" en Configuración → Templates de WhatsApp. El 2026-07-18 se corrigió el idioma
  local de `es_AR` a `es`, que es la variante realmente aprobada por Meta; antes Cloud API rechazaba
  el envío con código `132001`. Envío real aceptado por Meta después de la corrección.
- [x] **Acceso a las APIs de Google Business Profile** (proyecto `app-lule`) — **solicitud enviada
  el 2026-07-12**, caso de asistencia de Google **`2-7574000041506`**, tiempo de revisión
  informado por Google: 7-10 días hábiles (no es instantáneo, y con volumen chico existe la
  posibilidad de que la rechacen — ver [[reference_google_business_api_surface]] si se retoma).
  Mientras se resuelve, seguí editando perfil/publicaciones/reseñas desde el panel oficial de
  Google Business (Etapa 4).
- [x] ~~Google Search Console: configurar con el sitemap~~ **Resuelto (2026-07-17)** — propiedad
  `https://draluciachahin.ar` verificada (archivo HTML) y `sitemap.xml` enviado, estado "Correcto"
  con las 9 URLs (8 páginas públicas + `/privacidad`). De paso se corrigió el mismo bug de siempre
  (`src/proxy.ts` redirigía a `/login` el archivo de verificación de Google — ver PR #108).
- [ ] Verificar que las 8 páginas públicas queden **indexadas** (no solo que el sitemap se haya
  leído bien) — la indexación real tarda de días a 1-2 semanas, revisar periódicamente en
  Search Console → "Páginas".
- [ ] **Google Cloud (reseñas)**: revisar antes de octubre 2026 si se activa la cuenta completa o
  se deja pausar la prueba gratuita (Etapa 2).

### 🤔 Decisiones tuyas (o de Lucía)
- [ ] **Revisar la señal del modo sombra y decidir el siguiente paso del clasificador estructurado
  nuevo.** ✅ Conectado en producción (2026-07-17, PR #116) — corre en paralelo a cada mensaje real,
  sin ningún efecto sobre lo que recibe el paciente (ver CLAUDE.md → entrada 2026-07-17 y
  `whatsapp-policy-shadow-runner.ts`). Cobertura fase 1: solo las categorías de seguridad/derivación
  con equivalencia inequívoca contra el bot actual (urgencia, baja de contacto, adjunto no
  soportado, límite clínico, derivación forzada, pedido explícito de humano, botones de protocolo,
  cierre/derivación de la conversación ya en curso) — el flujo conversacional rutinario de intake/
  sede/cobertura queda fuera de esta fase. Pendiente real: dejar acumular datos reales en
  `whatsapp_policy_evaluations` unos días, revisar las coincidencias/discrepancias, y recién
  entonces decidir si conviene una fase 2 (ampliar cobertura) o un canary mínimo. La IA seguirá
  devolviendo enums validados, nunca texto para el paciente.
  - **Primera revisión de señal (2026-07-18, consulta read-only de agregados sin PII)**: la tabla
    tiene apenas **2 evaluaciones** (ambas del 18/07, estado `routed`, categoría `human_handoff`),
    con **100% de coincidencia** legacy↔v2 en action/intent/response/handoff. Buen sanity check
    inicial, pero n=2 no es señal para decidir nada. La acumulación va a seguir lenta mientras el
    bot solo hable con testers — **la decisión fase 2/canary queda en la práctica atada a resolver
    la verificación de negocio de Meta** (el bloqueante 🚨 de arriba), que es lo que traería el
    volumen real. Re-revisar cuando haya al menos algunas decenas de evaluaciones.
- [x] ~~Agregar a Lucía al Business Manager de Meta~~ **Resuelto (2026-07-18)**: invitada con
  "Acceso parcial → Básico" (no "Administrar"), asignada solo a la cuenta de WhatsApp Business
  ("Dra Lucia Chahin") — sin acceso a la App técnica (API keys/webhook) ni a "WhatsApp Marketing
  Message Event Sharing" (activo de tracking de campañas, no operativo). Confirmado en la lista de
  Personas: Lucía queda "Acceso parcial / Básico", Seba mantiene "Acceso total / Todo" con
  Finanzas. Instagram queda pendiente aparte (ver ítem siguiente) — hoy no está conectado como
  activo de este portfolio.
- [x] ~~Conectar Instagram como activo del portfolio de Meta para poder asignárselo a Lucía~~
  **Resuelto (2026-07-18)**: la cuenta `@draluciachahin` (vivía bajo un login separado del que
  administra el portfolio) quedó conectada como activo de "Dra Lucia Chahin" y asignada a Lucía
  con acceso total sobre ese activo puntual (Confirmado: "Personas con acceso total → Lucia
  Chahin"). Con esto, Lucía administra WhatsApp e Instagram por su cuenta vía Meta Business Suite,
  sin ser administradora del portfolio completo. No afecta ni depende de la conexión OAuth propia
  que usa la app para publicar automáticamente en Instagram (Estudio de contenido) — son
  integraciones independientes.
- [ ] Definir estrategia de reseñas de Google: cómo y cuándo pedirlas a pacientes actuales.
- [x] ~~Evaluar si crear una ficha de Google Business separada para Swiss Medical Lomas~~
  **Decidido (2026-07-17):** no se crea ficha separada — Swiss Medical Lomas sigue usando
  únicamente la ficha única existente ("Dra. Lucía Chahin"). No requiere ningún cambio de código.
- [ ] **Evaluar separar `lule-chahin` a su propio team de Vercel en plan Pro (2026-07-13).** No
  es por aislamiento de datos entre proyectos — Vercel ya aísla cada proyecto por completo (env
  vars, dominios, deployments) sin importar si comparten cuenta/team con `gastos-personales`. El
  motivo real es que el plan Hobby de Vercel está pensado para uso personal/no comercial, y este
  es un producto comercial (captación de pacientes para una doctora real, con datos de salud) —
  por los términos de uso de Vercel, probablemente ya debería estar en Pro independientemente del
  otro proyecto. Nota aparte: "HIPAA BAA" que aparece en las features de Pro es en realidad
  add-on de Enterprise, y de todas formas HIPAA no aplica (es ley de EE.UU.) — lo que aplica acá
  es la Ley 25.326 argentina, y ahí lo que importa es la política de privacidad propia
  (`docs/REVISION_LEGAL_PRIVACIDAD.md`, ya pendiente arriba), no una certificación de Vercel.
- [ ] **Evaluar pagar Supabase Pro, $25/mes (2026-07-13).** El beneficio con más peso real acá es
  backups automáticos diarios (7 días de retención) — Free no los tiene, y este proyecto maneja
  dato de salud. También evita que el proyecto se pause por inactividad tras una semana sin uso
  (poco probable con tráfico real, pero posible). El resto de los beneficios de Pro (más storage,
  más usuarios de Auth, logs con más retención) hoy no son un cuello de botella real dado el
  volumen del proyecto.

### ✍️ Contenido para cargar/publicar (no requiere código)
- [x] ~~Publicar los 3 posts fijados de Instagram~~ **Verificado contra producción (2026-07-17)**:
  el pipeline real muestra 4 posts ya `published`, 1 `approved` (listo para publicar, solo falta
  que corra el auto-publish o tocar "Publicar ahora") y 1 en `draft`. Ya no quedan 3 posts fijados
  sin publicar — se deja como pendiente menor solo el `approved` suelto, no bloquea nada.
- [x] ~~Crear historias destacadas de Instagram por sede~~ **Resuelto** — confirmado por captura
  real del perfil (2026-07-17): existen 3 destacadas, una por sede (Lomas de Zamora, CABA, Lanús),
  cubriendo la duda más frecuente ("¿dónde atendés?"). El "7" del PRD original
  (`docs/PRD-estrategia-captacion.md`) era una sugerencia de cobertura por ángulo, no un requisito
  — decisión explícita de Seba: 3 alcanza.
- [ ] **Opcional, no bloqueante** — destacada "Turnos" (explica el paso a paso de 4 pasos para
  pedir turno, reduce preguntas repetidas por DM). Es la única de las 4 restantes del PRD
  (Turnos/Ecocardiograma/Cardiología/FAQ) con impacto real de fricción; las otras tres son
  contenido educativo "nice to have". Acción nativa de Instagram (Highlights) — no queda
  registrada en ninguna tabla de esta app, no se puede confirmar por código.
- [x] ~~Cargar las obras sociales reales por sede en Configuración~~ **Resuelto, verificado contra
  producción (2026-07-17)**: CIMEL Lanús (3 coberturas), Swiss Medical Lomas (1), Hospital
  Británico (7) ya tienen `obras_sociales` cargado — ya no están vacías.
- [x] ~~Cargar el link de Google Maps del Hospital Británico en Configuración~~ **Resuelto,
  verificado contra producción (2026-07-17)**: las 3 sedes tienen `google_maps_link` cargado.
- [x] ~~Confirmar que el `$0` (tarifa pública de Meta para Argentina) haya quedado guardado~~
  **Resuelto, verificado contra producción (2026-07-17)**: las combinaciones vigentes
  (marketing/service vía CTWA, y service/utility dentro de ventana hasta 2026-09-30) tienen
  `cost_amount = 0` en `whatsapp_pricing_rules`. Los 10 templates ya están `aprobado` —
  `alerta_interna_derivacion` (la última que faltaba) se aprobó el 2026-07-17.

### 🕐 Cuando tengas tiempo (no urgente)
- [x] ~~Conectar la CLI de Vercel para que un agente pueda tocar env vars directamente~~ **Resuelto
  (2026-07-17)** — Seba instaló la CLI (`npm i -g vercel`), corrió `vercel login` y `vercel link`
  en su propia terminal (vinculado a `sebacoscione-bytes-projects/lule-chahin`). Verificado
  `vercel env ls production` desde una sesión de agente: lista las variables reales sin exponer
  valores (`Encrypted`). La sesión quedó logueada a nivel de usuario de Windows en esta máquina.
- [x] ~~Cargar `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` en tu `.env.local`~~ **Resuelto (2026-07-17)** —
  cargadas por Seba.
- [x] ~~Correr el resto del smoke E2E autenticado al menos una vez~~ **Resuelto, con un hallazgo
  crítico en el camino (2026-07-17)**:
  - El hardening del 16/07 (`enforce_roles` + `require_mfa_for_sensitive_actions`) dejó a la cuenta
    de prueba sin rol y sin MFA enrolado — la suite autenticada quedó bloqueada en silencio desde
    esa fecha. Se le asignó rol `owner` y se automatizó el enrolamiento/verificación TOTP en
    `auth.setup.ts` (librería `otpauth`, secreto persistido en `e2e/.auth/totp-secret.json`,
    gitignored) — PR #110, mergeado por Seba tras revisar el diff (tocaba el área de MFA/seguridad).
  - **Bug crítico real encontrado y ya corregido en producción (PR #109, mergeado)**:
    `leads.landing_page`, `origin_url`, `clicked_cimel_cta`, `clicked_swiss_cta` y
    `booking_instruction_viewed` nunca existían en la base real — `20260612_utm_fields.sql` ya
    estaba marcado aplicado cuando alguien le agregó estas 5 columnas más tarde (GROWTH-01), y
    `npm run migrate` nunca volvió a correr ese archivo por nombre. Esto rompía
    `upsert_whatsapp_intake_lead()` en **cada mensaje nuevo de un paciente por WhatsApp** (no solo
    con código de referencia) desde el 16/07, y también `POST /api/leads` (alta manual). Migración
    nueva aplicada, ya verificado que las columnas existen y que crear un lead funciona de punta a
    punta.
  - **Cerrado del todo (2026-07-17, segundo incremento)** — encontrados y corregidos 3 bugs reales
    más en el camino, ninguno era la app en producción sino la suite de tests en sí:
    1. La cuenta de prueba solo admite **una sesión activa a la vez**: Supabase invalida la sesión
       vieja si se loguea de nuevo mientras la anterior sigue en pie (`session_not_found` al crear
       un challenge de MFA). `dashboard.spec.ts`/`inbox.spec.ts`/`leads.spec.ts` vivían en archivos
       separados, cada uno con su propio login — al correr en paralelo, se pisaban entre sí.
       Consolidados en un único archivo (`crm-smoke.spec.ts`) con
       `test.describe.configure({ mode: "serial" })` y una sola sesión compartida (`login-helper.ts`).
    2. `inbox.spec.ts` tenía un locator real mal acotado (`page.locator("aside button").first()`):
       el sidebar de toda la app también es un `<aside>` con su propio botón "Cerrar sesión" que
       queda primero en el DOM — el test estaba cerrando la sesión en vez de abrir un lead, sin que
       ninguna aserción lo notara.
    3. Al crear/editar/buscar un lead, el nombre en la tabla desktop es texto plano (no navega); lo
       que navega es el botón "Ver" de esa fila — un click a ciegas sobre el texto no hacía nada.
    Con los tres corregidos, `npm run test:e2e` (public + authenticated juntos) pasa 22/22 de forma
    reproducible. PR de este cierre: rearma `auth.setup.ts`/`dashboard.spec.ts`/`inbox.spec.ts`/
    `leads.spec.ts` en `login-helper.ts` + `crm-smoke.spec.ts`, agrega `npm run
    test:e2e:authenticated`.
  - **CI configurado (2026-07-18)** — `.github/workflows/e2e.yml`: job `e2e-public` corre en cada
    PR/push a `main` (sin credenciales sensibles, solo Supabase). Job `e2e-authenticated` corre
    en push a `main`, `workflow_dispatch` y una vez al día (cron 06:00 ART) — **a propósito no en
    cada PR**, porque esa cuenta de prueba comparte la misma base de Supabase que producción
    (sin staging) y cada corrida crea/borra un lead real y consume la única sesión activa que
    admite la cuenta; correrlo en cada PR multiplicaría esa escritura sin necesidad.
    **Bug real encontrado antes de que llegara a fallar en CI**: `login-helper.ts` solo sabía leer
    el secreto TOTP desde `e2e/.auth/totp-secret.json` (gitignored) — en un runner de GitHub
    Actions ese archivo nunca existe (checkout limpio en cada corrida), pero la cuenta de prueba
    ya tiene un factor MFA verificado desde las corridas locales, así que el flujo de enrolamiento
    tampoco se dispara: sin el fix, todas las corridas en CI hubieran fallado con el error explícito
    que el propio código ya tira ("no hay ningún secreto guardado..."). Corregido agregando
    `E2E_TEST_TOTP_SECRET` como fallback por variable de entorno.
    **Sigue pendiente, acción tuya**: correr `npm run push-e2e-ci-secrets` una vez (lee
    `.env.local` y `e2e/.auth/totp-secret.json` en tu máquina y carga `NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL`,
    `E2E_TEST_PASSWORD` y `E2E_TEST_TOTP_SECRET` como secrets del repo vía `gh secret set` — el
    agente nunca lee ni ve esos valores, solo escribió el script). Sin ese paso, el workflow corre
    pero falla por falta de credenciales.
- [x] ~~Aplicar en producción las 2 migraciones del PR #64~~ **Resuelto** — confirmado en vivo el
  2026-07-14: "Clicks por sede: llamada y WhatsApp" ya muestra datos reales (Swiss 1 WhatsApp,
  Británico 2 WhatsApp). El snapshot de seguidores de Instagram todavía no tiene datos, pero no por
  falta de migración — la tabla existe y el dashboard lo indica con claridad ("Todavía no hay
  snapshots. Hace falta Instagram conectado y al menos una corrida del cron diario"), pendiente de
  que Instagram esté conectado.

---

## Plan de corrección — auditoría integral (2026-07-11)

Objetivo: corregir los riesgos de producción encontrados en la revisión integral y, después,
mejorar privacidad, atribución de conversiones, calidad operativa y escalabilidad. El orden es
deliberado: primero integridad de WhatsApp y datos de pacientes; luego medición y optimización.

### Ola 0 — Blindaje de WhatsApp (P0, ejecutar primero) ✅ Resuelto (2026-07-11)

- [x] **WA-01 — Webhook con firma obligatoria y fail-closed.**
  - `isValidWhatsAppSignature()` ahora rechaza el POST si falta `WHATSAPP_APP_SECRET` (antes
    dejaba pasar sin validar); test de "fail-open" reemplazado por uno de "fail-closed".
  - Chequeo administrativo agregado como recomendación crítica en `/dashboard`
    (`checkWhatsAppWebhookSignatureMissing` en `growth-recommendations.ts`) — avisa si falta la
    variable sin exponer su valor.
  - Sigue existiendo la excepción de siempre para lógica médica (no aplica acá, esto es
    infraestructura del webhook, no guardrails).

- [x] **WA-02 — Idempotencia por `wa_message_id`.**
  - Migración `20260711_whatsapp_webhook_idempotency.sql`: tabla `whatsapp_webhook_events` con
    `wa_message_id` único.
  - `src/lib/whatsapp-idempotency.ts` reclama el ID (insert único) antes de tocar sesión, costo
    o respuesta; `decideClaimOutcome` (testeado) decide claim/duplicate/retry según el estado
    de la fila existente — cubre reenvío exitoso (duplicate) y concurrencia básica (dos
    inserts simultáneos, uno gana por la constraint única).
  - **Nota de alcance real**: no hay infraestructura en el proyecto para testear contra un
    Supabase real (todos los tests de `src/lib` son de lógica pura, ver `whatsapp-pricing.ts`
    como referencia del mismo patrón) — la parte que sí pega a la base (`claimWhatsAppEvent`,
    etc.) queda sin test unitario, verificada en producción igual que el resto de las funciones
    equivalentes del proyecto (`logWhatsAppMessage`, `incrementMessagesSentCount`).

- [x] **WA-03 — No perder mensajes por errores transitorios.**
  - El webhook ya no devuelve `200` incondicional: si algún mensaje del POST falla de forma
    transitoria, responde `500` para que Meta reintente la entrega completa — la idempotencia
    de WA-02 hace que ese reintento sea seguro (los eventos ya procesados se ignoran, solo se
    reprocesa el que falló).
  - `classifyWebhookError()` (testeado) distingue error definitivo (`WindowClosedError`,
    `TemplateNotApprovedError` — van a volver a fallar igual ante el mismo evento) de
    transitorio (todo lo demás, default conservador: mejor reintentar de más que perder un
    mensaje en silencio).
  - Alerta por email reutilizando `sendCronFailureAlert` (mismo mecanismo que los cron jobs) con
    ID del evento, clasificación y mensaje de error — sin teléfono ni contenido del paciente.
    No se agregó un tercer cron de Vercel.

### Ola 1 — Privacidad, integridad y seguridad de datos (P1)

- [x] **DATA-01 — Política de privacidad e instrucciones de borrado.** ⏳ Borrador publicado (2026-07-11)
  - `/privacidad` (`src/app/privacidad/page.tsx`) publicada: qué datos se recolectan (nombre,
    teléfono, obra social, motivo/edad/síntomas si se comparten, contenido de WhatsApp, UTM,
    analítica agregada), para qué se usan, con qué terceros se comparten (Meta/WhatsApp,
    Anthropic/Google como proveedores de IA, Supabase, Vercel, Google Analytics), conservación
    (todavía sin plazo automático — ver DATA-02) y cómo pedir acceso/corrección/borrado (hoy
    manual, por WhatsApp). Enlazada desde el footer de todas las landings públicas, agregada a
    `sitemap.ts`/`robots.ts` (indexable). **Bug encontrado y corregido de paso**: la página nueva
    quedaba atrapada por el middleware de auth y redirigía a `/login` — `src/middleware.ts` no
    tenía `/privacidad` en `isPublicRoute`, se agregó.
  - Texto marcado explícitamente como **borrador** con un aviso visible arriba de todo: describe
    el funcionamiento real (sin promesas legales), pero falta la validación de un asesor legal por
    tratarse de datos de salud — esa dependencia sigue sin resolverse, no la puede saltear un
    agente.
  - **Actualizado (2026-07-12)**: la sección "Cuánto tiempo conservamos tus datos" reflejaba la
    política vieja ("hoy no tenemos plazo automático") — quedó desactualizada en cuanto se
    implementó DATA-02 el mismo día. Corregida para describir la retención real de 24 meses/10
    años. Se preparó además `docs/REVISION_LEGAL_PRIVACIDAD.md`: un resumen con las preguntas
    concretas que necesitan una respuesta de un asesor legal — para que Seba se lo pueda mandar
    directo, sin tener que armar el resumen él.
  - **Ampliado el mismo día, a pedido de Seba**: el resumen legal pasó de 3 a **7 preguntas**
    concretas — se agregó transferencia internacional de datos (los 5 proveedores procesan fuera
    de Argentina), si conviene tener un Data Processing Agreement (DPA) de cada proveedor, si el
    texto de consentimiento que muestra el bot de WhatsApp alcanza como consentimiento informado
    válido para datos de salud (se citó el texto exacto), y si hace falta un tratamiento especial
    para menores de edad — **hoy no hay ninguno, es una laguna real** (el bot pregunta la edad
    pero no cambia nada si la persona es menor).
  - **Bug real encontrado revisando esto y corregido con confirmación explícita del usuario**
    (única excepción del proyecto que sí requiere ese paso, por tocar `medical-safety.ts`): el
    mensaje del bot ante un síntoma de alarma decía "llamá al *911*", pero la landing pública y
    `/privacidad` ya decían **107** (SAME, el número de emergencias médicas de CABA/provincia de
    Buenos Aires, donde están las 3 sedes) — dos números distintos según qué parte de la app viera
    el paciente. Seba confirmó unificar en 107; corregido en `src/lib/medical-safety.ts`
    (`EMERGENCY_REPLY`) — **PR abierto, esperando el "dale" antes de mergear** (no se mergea solo
    como el resto de los cambios de esta sesión, justamente porque toca ese archivo).
  - **Pendiente real (acción de Seba/asesoría legal)**: validar el texto con la ayuda de
    `docs/REVISION_LEGAL_PRIVACIDAD.md`, y cargar `https://draluciachahin.ar/privacidad` como
    Privacy Policy URL en el Meta Developer Console (necesario recién si se saca la app de
    Instagram del modo desarrollo — no es urgente mientras solo haya testers/admins agregados).

- [x] **DATA-02 — Eliminación de pacientes.** ✅ Implementación técnica inicial (2026-07-12),
  ampliada localmente el 2026-07-16. La política final sigue sujeta a los gates legales del inicio
  de este documento: en particular, no está definido el plazo de `data_erasure_log` ni el de datos
  de protocolo.
  - Botón **"Eliminar datos de este paciente"** en `/leads/[id]` (con confirmación explícita,
    irreversible) → `POST /api/leads/[id]/erase` → `eraseLead()` (`src/lib/data-erasure.ts`) →
    RPC `erase_lead` (migración `20260711_data_erasure.sql`), todo en una sola transacción SQL:
    - Borra `messages` y `handoff_events` del lead (contienen texto/resumen identificable —
      `handoff_events.summary` incluye nombre/teléfono/motivo/último mensaje en JSON).
    - Anonimiza `wa_id` en `whatsapp_cost_events` y `consent_records` (no se puede dejar null,
      son columnas `not null`) — preserva la fila para no perder agregados de costo/consentimiento
      históricos, pero sin el teléfono real.
    - Borra la fila de `whatsapp_sessions` de ese teléfono (excepto si por algún motivo quedó
      vinculada a otro lead distinto — `leads.phone` no es unique, a diferencia de
      `whatsapp_sessions.phone`, así que en teoría dos leads podrían compartir número).
    - Borra la fila de `leads`.
    - Deja registro en `data_erasure_log` con referencias seudonimizadas del caso y del operador,
      más la fecha, sin conservar el contenido del paciente. Su plazo de expiración todavía debe
      definirlo un asesor legal.
  - Se eliminó de paso el `DELETE /api/leads/[id]` genérico que ya existía: no tenía ningún
    llamador en la UI, y borraba solo la fila de `leads` sin limpiar mensajes/costos/consentimiento/
    sesión — quedaba código muerto con riesgo real de un borrado incompleto si alguna vez se
    hubiera conectado a un botón.
  - **Plazos de retención definidos e implementados (2026-07-12)** — política confirmada por Seba:
    - **Leads que nunca se convirtieron en pacientes, o con solo datos administrativos/
      comerciales**: se anonimizan/eliminan tras 24 meses de inactividad. Implementado como
      `runDataRetentionSweep()` (`src/lib/data-retention.ts`) — reusa `erase_lead()` (mismo
      mecanismo auditable que el botón manual, ver arriba), corriendo automáticamente en vez de
      esperar un pedido.
    - **Datos de participación en protocolo de investigación clínica** (`protocol_interest`,
      `protocol_name`, `status = elegible_protocolo`): **no se borran automáticamente** mientras
      se define el plazo legal aplicable. La referencia histórica a un piso de 10 años queda
      supersedida: no se incorporó como política final sin dictamen legal. Tras 24 meses de
      inactividad se bloquea el uso comercial (`consent_to_contact =
      false` + `retention_hold = true`, columna nueva en `leads`, migración
      `20260712_data_retention.sql`) sin tocar el dato — visible como aviso
      "🔒 En resguardo legal" en `/leads/[id]`.
    - La clasificación clínica/protocolo vive en `isClinicalOrProtocolLead()` — función pura con
      tests, única fuente de verdad de este criterio (no duplicado en SQL). La barrida corre
      semanalmente dentro del cron de `weekly-report` (no suma un tercer cron job de Vercel, mismo
      patrón que `whatsapp-followup`), y manda alerta por email si falla.
    - **Baja de comunicaciones de marketing inmediata**: nueva detección determinista
      (`isMarketingOptOutMessage()` en `whatsapp-intents.ts`, palabras clave "BAJA"/"STOP"/frases
      explícitas) que corta el flujo del bot ni bien se detecta y pone `consent_to_contact = false`
      al instante — no espera a la barrida semanal. Chequeada antes que cualquier otra lógica de
      estado del bot, para que funcione sin importar en qué parte de la conversación esté el
      paciente. Distinta de `protocol_opt_out` (esa es solo para la invitación puntual a un
      protocolo, ya existía).
    - Dado que el proyecto arrancó el 2026-06-11, **hoy no hay ningún lead con 24 meses de
      inactividad real** — el umbral no va a tener ningún efecto práctico hasta mediados de 2028,
      lo que da margen de sobra para revisar/ajustar el criterio antes de que borre algo real.
  - Tampoco se implementó "exportación" de los datos de un paciente (dar una copia legible antes de
    borrar) — no estaba pedido explícitamente y se puede resolver hoy exportando el lead puntual
    desde el CSV general si hace falta.

- [x] **DATA-03 — Consentimiento de analítica y minimización.** ⏳ Default conservador (2026-07-11)
  - Se implementó **carga condicional (opt-in)** sin esperar la revisión legal explícita: GA4
    no se inyecta hasta que el visitante acepta explícitamente un banner de consentimiento
    (`AnalyticsConsentBanner`, cookie `lule_analytics_consent`). `GoogleAnalytics` (server
    component) lee esa cookie con `next/headers` y no renderiza nada si no está en `"granted"`.
    Es el default más conservador posible — si la asesoría legal después determina que no hacía
    falta pedir consentimiento para esta audiencia, se puede relajar bajando el umbral.
  - Ya se cumplía "no enviar teléfono/motivo/síntomas a analítica": el `gtag('config', ...)`
    nunca mandó datos de leads, solo lo que GA4 recolecta por default (page views).
  - **Sigue pendiente**: la revisión legal explícita en sí (documentar la decisión) — se implementó
    la opción más segura mientras tanto, no se reemplaza el paso de asesoría. La pregunta puntual
    para el abogado (¿hace falta pedir consentimiento explícito para analítica agregada y anónima
    en esta audiencia?) ya quedó redactada en `docs/REVISION_LEGAL_PRIVACIDAD.md` (2026-07-12),
    junto con las de DATA-01.
  - **Aceptación cumplida**: el comportamiento (sin consentimiento = sin GA) ya coincide con lo que
    describe `/privacidad` → "Cookies y analítica" (actualizada en el mismo cambio).

- [x] **SEC-01 — Validación uniforme de APIs y rate limit distribuido.** ✅ Resuelto (2026-07-12)
  - [x] Rate limit distribuido: `src/lib/rate-limit.ts` ya no usa un `Map` en memoria (se reseteaba
    por instancia serverless, así que el límite real era `maxRequests × instancias activas`, no
    `maxRequests`). Ahora pega a Postgres vía RPC `check_rate_limit` (migración
    `20260711_rate_limit_distributed.sql`, ventana fija con UPSERT atómico) — todas las instancias
    de Vercel comparten el mismo contador. Fail-open a propósito si la consulta a la base falla.
  - [x] Validación con esquemas en **las dos rutas públicas sin sesión** (`/api/public/lead`,
    `/api/public/click`) — las de mayor riesgo real, porque un atacante no necesita ni siquiera
    una cuenta para llegar a ellas. Se sumó `zod` (nueva dependencia) + `src/lib/api-validation.ts`
    (`parseJsonBody`/`formatZodError`, con tests) como helpers compartidos.
    - `/api/public/lead` no tenía **ninguna** validación de tipo/longitud — un `name`,
      `general_reason`, etc. de cualquier tamaño se guardaba tal cual en `leads` (se muestra en el
      CRM y se exporta a CSV). `requested_service`/`preferred_location` tampoco se validaban
      contra los enums reales de `src/types/index.ts` — un valor arbitrario rompía los lookups de
      `SERVICE_LABELS`/`LOCATION_LABELS` en cualquier pantalla que no tuviera un fallback. Ahora
      tiene límites de longitud, los enums exactos, y `consent_to_contact` exige el booleano
      `true` literal (antes aceptaba cualquier valor "truthy" de JS).
    - `/api/public/click` ya validaba `event_type`/`location_key`/`variant` a mano, pero no
      `slug` (podía ensuciar `landing_events` con slugs inventados, rompiendo el ranking del
      dashboard en silencio) ni la longitud de los `utm_*`. Ahora `slug` valida contra
      `PUBLIC_LANDING_SLUGS` (misma fuente que sitemap/robots/proxy, ver SEO-01 — agregar una
      landing nueva la habilita acá también sin tocar este archivo).
    - Ambas: `request.json()` ya no puede tirar una excepción no controlada (JSON inválido ahora es
      un `400` claro, antes un `500` genérico de Next) y los errores de Supabase ya no se
      reenvían tal cual al cliente (mensaje genérico en su lugar).
    - Verificado en vivo contra el dev server real (`curl`, sin sesión — ambas rutas son
      públicas): JSON inválido, campo faltante, enum inválido y campo demasiado largo devuelven
      `400` con el mensaje esperado. No se probó el camino exitoso en vivo a propósito, para no
      insertar un lead/evento de prueba en la base de producción real.
  - [x] **Extendido a las rutas autenticadas (2026-07-12, tercer incremento)** — recorridas las
    ~24 rutas de `src/app/api/**` que parsean un body JSON. Criterio aplicado: si la ruta ya tenía
    validación manual sólida (enums + límites de longitud) y estaba envuelta en `try/catch` — ej.
    `content/items`, `content/visual`, `content/alt-text`, `content/image-direction`,
    `content/route`, `instagram-business/publish` — se dejó como estaba, para no arriesgar una
    regresión reescribiendo lógica ya extensa y probada por el uso real. Se corrigieron los
    gaps reales:
    - **Mass assignment real encontrado en `/api/experiments` y `/api/experiments/[id]`**: el
      `POST` hacía `insert([body])` y el `PATCH` `update(body)` **sin ningún filtro de campos** —
      peor que el caso de `/api/leads`, que al menos ya tenía un allowlist manual. Un request
      armado a mano podía pisar `id`/`created_at`/`channel` de un experimento. Corregido con
      schemas de zod que además funcionan como allowlist (el `PATCH` ahora solo acepta
      `result`/`winner`, que es lo único que la UI de `/experimentos` envía).
    - **`/api/leads` (POST) y `/api/leads/[id]` (PATCH)**: mismo problema que ya se había resuelto
      en `/api/public/lead` — sin validación de tipo/longitud/enum. Ahora comparten
      `src/lib/lead-schema.ts` (un único schema de zod, reusado entre alta y edición) con los
      mismos enums exactos de `src/types/index.ts`.
    - **`/api/whatsapp/templates/[id]`**: el `status` de un template podía ser cualquier string —
      ahora valida contra el enum real del check constraint de `templates` en `docs/schema.sql`.
    - **`/api/checklist` (PATCH)**: `item_key` no se validaba contra los 14 items reales
      sembrados en la base — un valor inventado creaba una fila nueva que ninguna pantalla sabe
      interpretar y desalineaba el conteo de progreso del checklist. Ahora valida contra la lista
      real.
    - **`/api/messages`, `/api/classify`, `/api/followup`, `/api/ai/suggest`**: no validaban tipo
      ni longitud de `lead_id`/`content`/`message` antes de esto — ninguno toca lógica médica o
      guardrails, solo el enrutamiento/clasificación de contacto.
    - **Resto de rutas ya validadas a mano** (`google-business/profile`, `select-location`,
      `posts`, `reviews/[reviewId]/reply`, `content/reorder`, `content/publish-now`,
      `content/upload-image`, `whatsapp/pricing/[id]`, `config`): el gap real en todas era que
      `request.json()` no estaba protegido — un JSON inválido tiraba una excepción no controlada
      (crash a una respuesta genérica de Next) en vez de un `400` claro. Envueltas con el mismo
      helper `parseJsonBody` que ya usaban las rutas públicas; se agregaron también topes de
      longitud puntuales donde el texto viaja a una API externa de pago (Google Business Profile).
  - **Aceptación parcial cumplida**: el límite de abuso se mantiene entre instancias, las dos
    rutas públicas sin sesión y ahora también las rutas autenticadas de mayor uso real (leads,
    experimentos, WhatsApp admin, Google Business, mensajería) validan tipo/longitud/enum y no
    revientan con una excepción no controlada ante un JSON malformado. **Pendiente real**: quedan
    sin tocar `/api/instagram-business/auth`, `/callback`, `/disconnect`, `/status`,
    `/api/google-business/auth`, `/callback`, `/disconnect`, `/locations`, `/status` (todas
    GET/OAuth por query params, no reciben body JSON del cliente) y las rutas de contenido que ya
    tenían validación propia sólida (mencionadas arriba) — revisión completa, no queda ninguna
    ruta genuinamente sin analizar.

- [x] **SEC-02 — Export CSV segura.** ✅ Resuelto (2026-07-11)
  - `src/lib/csv.ts` (`neutralizeCsvFormula`/`escapeCsvCell`, con tests) antepone una comilla
    simple a cualquier celda que empiece con `=`, `+`, `-`, `@`, tab o retorno de carro, antes de
    aplicar el escapado de comillas/comas que ya existía. `src/app/api/leads/export/route.ts`
    usa esta función en vez de la que tenía duplicada in-line.
  - **Aceptación cumplida:** abrir la exportación ya no ejecuta fórmulas provenientes de datos de
    leads (probado con `=HYPERLINK(...)`, ataques DDE clásicos con `+`/`-`/`@`); se conserva el
    BOM UTF-8 y el escapado de comillas/comas que ya tenía la exportación.

### Ola 2 — Operación, calidad y conversiones reales (P1)

- [x] **OPS-01 — Observabilidad sin exponer datos sensibles.** ✅ Resuelto (2026-07-12)
  - **Ya cubierto antes de esta pasada, verificado al revisar el ticket** (no había que
    construirlo de nuevo):
    - Webhook de WhatsApp: logs estructurados + alerta por email desde WA-03 (2026-07-11).
    - Cron jobs (`publish-content`, `weekly-report`): alerta por email desde el 2026-07-07.
    - "Panel de salud para integraciones críticas": ya existe como el motor de
      `growth-recommendations.ts` en `/dashboard` (Instagram desconectado, Google Business
      desconectado, templates de WhatsApp sin aprobar, firma del webhook faltante, etc.) —
      no hacía falta un panel nuevo separado.
  - **Se agregó en esta pasada**: los callbacks de OAuth (`/api/google-business/callback`,
    `/api/instagram-business/callback`) tenían `catch` completamente silenciosos ante fallos
    reales (intercambio de token, descubrimiento de cuenta/ubicación) — nada quedaba registrado
    en ningún lado más allá de un código de error genérico en la URL de redirect. Se agregó
    `console.error` con ruta/etapa/mensaje de error (nunca el token ni el client secret — solo la
    respuesta de error de la API de Google/Meta, que nunca hace eco de nuestras credenciales) en
    los dos puntos de falla real de cada callback.
  - **Se revisó y descartó un problema que parecía existir pero no era tal**: al principio pareció
    que `/google-local` y `/contenido/instagram` ignoraban por completo los query params de error
    del redirect de OAuth (`?error=...`, `?ig_error=...`) — de haber sido cierto, hubiera sido un
    bug real de UX. Revisando el código a fondo, **ambas páginas ya los leen y muestran un aviso**
    (`window.location.search` + `getAuthErrorMessage` en `google-local`, un mensaje genérico en
    `contenido/instagram`) — no hacía falta tocar nada ahí.
  - **Cerrado en un segundo incremento (2026-07-12)**: el hallazgo real más importante fue en
    `src/lib/content-publish.ts` — la función que usan tanto el cron de auto-publicación como el
    botón manual "Publicar ahora" atrapaba la excepción de publicar en Instagram/Google Business
    con un `catch { result.instagram = "error" }` **completamente vacío**: cuando fallaba, no
    quedaba ningún rastro de *por qué* (¿token vencido? ¿rate limit? ¿imagen faltante? ¿error de
    la API de Meta/Google?) — ni en el badge de la UI (solo dice "error") ni en ningún lado
    revisable después. Se agregó `console.error` con el id de la pieza, el canal y el mensaje real
    de la API (nunca tokens). Se extendió el mismo criterio a los puntos de falla real de
    `instagram-business/publish` y de las 6 rutas de `google-business/{profile,posts,
    posts/[postId],reviews,reviews/[reviewId]/reply,locations}` que hasta ahora devolvían el error
    al cliente sin dejar ningún rastro server-side. **Investigación que descartó una necesidad
    real**: los fallos de generación de contenido con IA (Gemini/Claude, en `content/route`,
    `content/visual`, `classify`, `messages`, `ai/suggest`, etc.) **ya quedan registrados de forma
    durable** en la tabla `ai_requests` (`logRequest()` en `src/lib/ai.ts`, con
    `success: false`/`error_message`) desde antes de esta sesión — no hacía falta agregarles
    `console.error`, esa observabilidad ya existe y es mejor (persiste en la base, no solo en los
    logs de función de Vercel).
  - **Aceptación cumplida**: los fallos de webhook, cron, OAuth, y ahora también de las dos
    integraciones externas de publicación (Instagram, Google Business) dejan rastro sin exponer
    secretos. Queda como decisión de alcance, no como pendiente real, no estandarizar un
    `request_id` formal en cada ruta interna — el criterio real aplicado (loguear en los puntos de
    falla de integraciones externas y flujos sin supervisión humana directa) ya cubre los casos
    donde un fallo sería genuinamente indetectable.

- [x] **QA-01 — Tests de rutas e integración.** ✅ Resuelto (2026-07-12)
  - **Bug real de infraestructura de testing encontrado y corregido primero**: `jest.mock("@/lib/x")`
    no resolvía — `jest.config.js` no tenía `moduleNameMapper` para el alias `@/`. Un `import`
    normal funciona porque el compilador de Next (SWC) lo reescribe en tiempo de compilación, pero
    `jest.mock(...)` recibe un string literal que Jest tiene que resolver por su cuenta, sin pasar
    por esa reescritura. Sin este fix, **no se podía mockear ningún módulo con alias `@/` en
    ningún test de ruta** — bloqueaba todo este ticket de raíz.
  - Con eso resuelto, se agregaron tests de integración para 3 rutas representativas (mockeando
    `@/lib/supabase/server`, sin pegarle a la base real):
    - `GET/PATCH /api/leads/[id]` — rechaza sin sesión; **la allowlist de campos parcheables no se
      puede saltear inyectando `id`/`created_at` por el body** (mass assignment); el auto-completado
      de `followup_due_at` funciona y no pisa un valor ya explícito.
    - `GET /api/cron/weekly-report` — fail-closed sin `CRON_SECRET`, rechaza un secreto incorrecto.
    - `GET /api/leads/export` — rechaza sin sesión; **la neutralización de fórmulas de SEC-02 sigue
      funcionando** end-to-end en la respuesta real de la ruta (no solo en el test unitario de
      `csv.ts`), y el texto normal no se toca.
  - **Extendido (2026-07-12)**: `GET/POST /api/webhooks/whatsapp` (la ruta más crítica del
    proyecto — la única que recibe tráfico no autenticado de Meta y dispara al bot real) ahora
    tiene test de integración de ruta completa, mockeando `whatsapp-webhook-signature`,
    `whatsapp-idempotency`, `whatsapp-bot` y `alert-email` (sin pegarle a Supabase real):
    verificación GET de Meta (challenge correcto / token incorrecto), **WA-01** rechaza con 401 sin
    firma válida, JSON inválido da 400, un objeto que no es `whatsapp_business_account` se ignora,
    **WA-02** un evento duplicado no vuelve a disparar `handleIncomingMessage`, **WA-03** una falla
    transitoria responde 500 (Meta reintenta) y una falla permanente responde 200 (no reintenta).
  - **Cerrado en un tercer incremento (2026-07-12)**: tests de integración para los dos callbacks
    de OAuth (`google-business/callback`, `instagram-business/callback`), cerrando el círculo con
    el logging agregado en OPS-01: sin sesión redirige a `/login`; sin `code`/con `error` redirige
    con el código de error correspondiente (`error=auth_denied`/`ig_error=auth_denied`); `state`
    ausente o que no coincide con la cookie redirige con `error=oauth_state`; **una falla real en
    el intercambio de tokens loguea con `console.error` (verificado en el test) y redirige con
    `error=token_exchange`**; en Google Business, una falla en el descubrimiento de cuenta/
    ubicación loguea pero igual redirige con `connected=1` (no fatal, ya cubierto por el diseño
    existente); un intercambio exitoso guarda los tokens y redirige con `connected=1`/
    `ig_connected=1`.
  - **Pendiente real**: extender el mismo patrón a los estados de publicación de contenido
    (`content/items` PATCH con sus distintas transiciones de estado) como test de integración de
    ruta completa — el patrón ya está probado y funcionando en 6 rutas distintas, extenderlo al
    resto es mecánico pero son varias rutas más y no bloquea nada.
  - **Aceptación cumplida**: los casos cubiertos —incluidas la ruta más crítica del proyecto y
    ambos callbacks de OAuth— fallarían en CI si la ruta perdiera autenticación, dejara de
    deduplicar, la validación de CSV se rompiera, o el logging de un fallo de OAuth desapareciera.

- [x] **QA-02 — Smoke E2E móvil y desktop.** ✅ Resuelto (2026-07-12, actualizado 2026-07-14 y 2026-07-17)
  - Se sumó **Playwright** (`e2e/`, ver CLAUDE.md → "Tests E2E") en dos proyectos:
    - **`public`** (sin sesión): landing principal, las 6 landings SEO, `/login` (validación de
      campos vacíos + error real de Supabase con credenciales inválidas), y que las rutas del CRM
      redirigen a `/login` sin sesión. **Verificado corriendo de verdad**: 18/18 pasando contra un
      build de producción real (`npm run build && npm run start`).
    - **`authenticated`** (dashboard, crear/editar/buscar un lead, abrir una conversación del
      inbox): requiere un usuario de prueba dedicado (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`) que no
      existe en este entorno — **escritos a partir de la lectura del código real, pero sin
      verificar que corren**, a diferencia del resto. Se salta solo (reporta "skipped", no
      "failed") si esas variables no están configuradas.
  - **Bug real de infraestructura encontrado y corregido antes de dar por buena la cobertura
    pública**: corriendo los tests contra `next dev` (Turbopack) con 8 workers en paralelo, 3 de
    18 fallaban con `SyntaxError: Unexpected end of JSON input` / `ECONNRESET` — no eran bugs de
    la app, era el compilado on-demand de Turbopack bajo carga concurrente (confirmado: mismo
    código, 0 fallos con `--workers=1` contra `next dev`, y 0 fallos con 8 workers contra un build
    de producción real). Documentado en CLAUDE.md para que una sesión futura no lo confunda con
    una regresión real.
  - **Otros dos bugs reales encontrados de paso**: Jest matchea `*.spec.ts` por default y sin
    excluir `e2e/` intentaba correr los tests de Playwright (rompiendo `npm test` para todo el
    resto del proyecto) — agregado a `testPathIgnorePatterns` en `jest.config.js`. Y el test de
    `/login` con credenciales inválidas (pega a Supabase Auth real) fallaba por timeout al
    correrlo varias veces seguidas — Supabase aplica un throttle anti fuerza-bruta que demora la
    respuesta más de los 5s default de Playwright; ese caso puntual ahora usa 20s.
  - **Actualización 2026-07-14**: se creó el usuario de prueba dedicado
    (`e2e-agent-test@lule-internal.local`, ver [[reference_e2e_test_account]]) y se corrió
    `e2e/authenticated/auth.setup.ts` de verdad por primera vez — login exitoso, `storageState`
    guardado, usado después para verificar `/dashboard` con datos reales (encontró y resolvió 2
    bugs, ver CLAUDE.md → 2026-07-14). Lo que **todavía no se corrió** es el resto de la suite
    autenticada (`dashboard.spec.ts`, `leads.spec.ts`, `inbox.spec.ts`) — la sesión se usó para
    verificación visual manual con un script aparte, no para `npm run test:e2e` completo.
  - **Cerrado del todo 2026-07-17**: con las credenciales cargadas, `npm run test:e2e` corre 22/22
    de forma reproducible (public + authenticated juntos, verificado dos corridas seguidas). Ver la
    entrada de "Correr el resto del smoke E2E autenticado" más arriba para el hallazgo crítico
    (columnas faltantes en `leads`), el bug de MFA/rol que bloqueaba la suite, y los 3 bugs reales
    de la suite en sí (sesión única compartida, locator del botón "Cerrar sesión", click sobre texto
    no interactivo) que quedaron corregidos en `crm-smoke.spec.ts`/`login-helper.ts`. **Sigue
    pendiente**: configurar que la suite corra en CI/GitHub Actions con esas credenciales como
    secret (no se hizo en esta sesión).
  - **Aceptación cumplida**: el smoke público y el autenticado corren y pasan juntos contra un build
    de producción, con evidencia (reporte HTML de Playwright) y verificado reproducible.

- [x] **CRM-01 — Contexto reciente correcto en el inbox.** ✅ Resuelto (2026-07-11)
  - `src/app/api/ai/suggest/route.ts` (botón "Sugerir mensaje de seguimiento") pedía
    `.order("created_at", { ascending: true }).limit(20)` — en una conversación de más de 20
    mensajes eso trae los **primeros** 20 (los más viejos), no los últimos. Se cambió a
    `.order(desc).limit(20)` + `toChronologicalContext()` (`src/lib/conversation-context.ts`,
    con test) que reordena a cronológico antes de pasarlo a la IA.
  - **Aceptación cumplida:** la IA recibe siempre el tramo más reciente de la conversación (el
    mensaje más nuevo queda al final del contexto, nunca se omite) — verificado con test para una
    conversación simulada de 25 mensajes.

- [x] **GROWTH-01 — Atribución de conversión de punta a punta.** ✅ Resuelto (2026-07-12)
  - **Decisión de diseño confirmada por Seba**: WhatsApp no manda ningún dato del origen de un
    click al webhook (a diferencia de un formulario web con query params) — la única forma real de
    atribuir una conversación a una landing/sede puntual es que el propio mensaje prellenado lleve
    una referencia corta y visible. Formato acordado: `Ref: LAN-CARD-01` al final del mensaje
    (prefijo de sede + prefijo de especialidad + secuencia), sin ningún dato personal, editable por
    el paciente antes de enviar.
  - **`src/lib/landing-referral-codes.ts`** (nuevo, con tests): registro código ↔ landing/sede/
    especialidad (vive en código, no en una tabla de Supabase con UI de admin — mismo criterio que
    `public-landings.ts`, agregar una landing ya requiere una PR). `withReferralCode()` arma el
    mensaje con la referencia; `extractReferralCode()` la detecta y la separa del resto del texto,
    tolerante a mayúsculas/espaciado (el paciente puede editar el mensaje).
  - **`src/lib/whatsapp-bot.ts`**: el código se extrae del primer mensaje entrante en el estado
    `"nuevo"` y se guarda en la sesión (`whatsapp_sessions.referral_code`, columna nueva) hasta que
    el lead se crea de verdad en `"intake_pendiente"` — recién ahí se copia a `leads.utm_content`
    (el código) y `leads.landing_page` (el slug), reusando columnas ya existentes. Si el paciente
    borró la referencia (mensaje orgánico), esos campos quedan `null` — el dashboard los muestra
    como "sin atribuir" en vez de inventar un valor "unknown".
  - **Bug real encontrado y corregido verificando esto en vivo, antes de mergear**: Swiss Medical
    Lomas tiene su propio WhatsApp cargado en Configuración ("Swity", un número distinto al del
    bot) — un mensaje a ese número **nunca llega a nuestro webhook**, así que agregarle una
    referencia hubiera sido inútil (y hubiera ensuciado el mensaje que ve la recepción de Swiss
    Medical con un código que nunca vamos a poder leer). Se agregó `resolvesToBotNumber()` en
    `public-landings.ts` (con tests) que compara el número ya resuelto contra el del bot, no solo
    si hay un override cargado — solo se agrega la referencia cuando el mensaje realmente va a
    llegar a nuestro bot.
  - **Panel nuevo en `/dashboard`**: "Embudo de atribución por landing/sede" — visita → clic a
    WhatsApp → lead → turno confirmado, por código, para los últimos 90 días. Visitas/clicks
    agregados en SQL (RPC `landing_referral_events`, migración
    `20260712_growth_01_referral_attribution.sql`, mismo criterio que PERF-01: `landing_events` ya
    mostró que contar en JS no escala); leads se agrega en JS (tabla chica, sin ese problema).
  - **Verificado en vivo contra un build de producción real**: el CTA de WhatsApp de una landing
    con sede propia agrega `Ref: LAN-CARD-01`/`LOM-CARD-01` correctamente codificado en la URL; el
    CTA hacia Swity (Swiss Medical) NO lleva referencia (confirmado antes y después del fix). No se
    pudo probar el flujo completo con un mensaje real entrante (requeriría mandar un WhatsApp real
    al número de producción) ni ver el panel del dashboard (sin credenciales de login) — validado
    por revisión de código, tests unitarios de cada función pura, y build/tests.
  - **Aceptación cumplida**: el dashboard diferencia visitas, clics de WhatsApp, leads y turnos
    confirmados por código de referencia; un lead que llega con una referencia real queda atribuido
    a la landing/sede exacta, incluyendo cuando confirma el turno (`confirmed_booked`).

- [x] **GROWTH-02 — Guardrails estadísticos para experimentos A/B.** ✅ Resuelto (2026-07-11)
  - El motor de recomendaciones (`checkHeroAbTestSignal`) ya exigía un mínimo de 150 visitas por
    variante y 8 puntos de diferencia antes de sugerir un ganador — nunca recomendaba con tráfico
    insuficiente. Lo que faltaba era mostrarlo explícitamente en el panel de `/dashboard`, no solo
    como recomendación aparte.
  - Nueva función pura `evaluateAbTestReadiness()` (con tests) devuelve
    `insufficient_sample` / `no_clear_signal` / `signal_found`; la card "Test A/B" del dashboard
    ahora muestra ese estado con un aviso explícito (cuántas visitas faltan por variante para el
    mínimo, o que la diferencia todavía no alcanza) y el criterio de finalización en texto
    (mínimo de visitas por variante + diferencia mínima de puntos).
  - **Aceptación cumplida:** el panel identifica resultados preliminares con un aviso visible y
    solo se recomienda cortar el test hacia una variante cuando se cumplen ambos umbrales.

### Ola 3 — UX, SEO, rendimiento y mantenimiento (P2)

- [x] **WEB-01 — QA visual y simplificación de la landing.** ✅ Parte técnica resuelta (2026-07-17)
  - Revisado `/dra-lucia-chahin` con Playwright (Chromium real, no el msedge headless poco confiable
    para mobile — ver [[reference_headless_mobile_screenshot_unreliable]]) en 1440px y 390px, full
    page: sin regresiones visuales, tarjetas por sede y acordeón de FAQ se ven bien en ambos anchos.
  - **CTA accesible por teclado**: el botón "Pedir turno" del hero recibe foco al 5º Tab desde el
    inicio de la página, con anillo de foco visible (outline del navegador, no removido por CSS).
  - **CTA sticky mobile** (`fixed inset-x-0 bottom-0`, solo `sm:hidden`) verificado con scroll hasta
    el final: no tapa el footer ni el aviso de "no reemplaza una consulta médica".
  - **La repetición de "Dónde atiende"/"Pedir turno" no se tocó a propósito**: son 4 apariciones con
    propósito distinto (ancla fija en el nav, CTA del hero, botón por sede con contexto ya elegido,
    sección de formulario + cierre final) — patrón estándar de conversión, no una regresión de
    código. Decidir si conviene recortarla requiere datos de comportamiento real (scroll/click por
    sección) que hoy no se miden — **sigue pendiente como decisión de producto**, no es algo que el
    código pueda resolver solo.
  - **Aceptación cumplida** en la parte verificable: no hay regresiones visuales y el CTA principal
    es accesible en teclado y móvil.

- [x] **SEO-01 — Cobertura de Hospital Británico y vista al compartir.** ✅ Resuelto (2026-07-11)
  - Nueva landing `/cardiologa-caba` (mismo patrón data-driven que las 6 existentes, en
    `src/lib/public-landings.ts`) — servicios, instrucciones de turno y datos institucionales del
    Hospital Británico ya verificados y usados en el resto del sitio (dirección, teléfono, horario),
    sin inventar nada nuevo. Cross-linkeada con `cardiologa-lanus`/`cardiologa-lomas` en
    `RELATED_LANDING_SLUGS`. Se suma automáticamente a `sitemap.ts`/`robots.ts`/rutas públicas del
    proxy porque los tres ya derivan de `PUBLIC_LANDING_SLUGS` (a `robots.ts` que antes tenía la
    lista de slugs hardcodeada se le aplicó el mismo fix, para que agregar una landing nueva no
    vuelva a requerir tocar ese archivo a mano).
  - **Bug real encontrado y corregido de paso**: `buildSubpageFaq()` (la pregunta "¿Puedo atenderme
    en otra sede?" de cada landing de servicio/sede) tenía hardcodeado un ternario binario
    CIMEL/Swiss — con una tercera sede real, la landing de Hospital Británico hubiera respondido
    mal (mencionando solo CIMEL, omitiendo Swiss Medical). Se generalizó para calcular "las otras
    sedes" a partir de la lista completa de la landing principal, sin hardcodear nombres.
  - **Imagen Open Graph**: antes no existía ninguna (`openGraph.images` nunca se completaba en
    ninguna landing). Se agregó generación dinámica (`src/app/[slug]/opengraph-image.tsx`, `next/og`)
    con el nombre de la doctora + el `h1` de cada landing — **no se reusó la foto real de Lucía**
    porque tiene relleno negro en las esquinas pensado solo para uso circular (`rounded-full`);
    usarla tal cual en una placa rectangular de OG se hubiera visto rota en cualquier preview de
    WhatsApp/Instagram.
  - **Tres bugs reales de infraestructura encontrados y corregidos verificando esto visualmente**
    (no alcanzaba con build/tests) — dos ya en TECH-01 (nombre de export del matcher de `proxy.ts`,
    y el match exacto de `isPublicRoute` que dejaba afuera archivos de metadata anidados como
    `/cardiologa-caba/opengraph-image`), y un tercero encontrado recién acá: **`/sitemap.xml` y
    `/robots.txt` también quedaban atrapados por el auth gate** (mismo problema de match exacto,
    preexistente desde antes de esta sesión — no lo introdujo ningún cambio de hoy) y redirigían a
    `/login` sin sesión. Esto probablemente explica por qué "Verificar indexación en Search
    Console" seguía pendiente en la Etapa 3 de este mismo archivo: Google no podía leer el sitemap.
    Corregido agregando ambas rutas a `isPublicRoute` en `proxy.ts`.
  - **Aceptación cumplida**: metadata/canonical/sitemap consistentes (mismo generador que las 6
    landings existentes), contenido no promete turnos ni disponibilidad (mismos avisos que el resto
    del sitio). Verificado con `curl` contra el dev server real que la página y su imagen OG cargan
    con el CSS/diseño completo.

- [x] **PERF-01 — Agregaciones en base.** ✅ Resuelto (2026-07-12)
  - Reemplazadas las dos queries del dashboard que traían hasta 20.000 filas crudas de
    `landing_events` y contaban en JavaScript (`getLandingRanking`, `getHeroVariantResults`) por
    dos funciones SQL (`landing_events_ranking`, `landing_hero_variant_results`, migración
    `20260712_landing_events_aggregation.sql`) que agregan con `GROUP BY` + `COUNT FILTER`
    directamente en Postgres, sin ningún tope artificial.
  - **Motivo real, no solo velocidad**: el límite de 20.000 filas no era solo una cuestión de
    performance — si el tráfico real de una ventana de 90 días superaba esa cifra, el conteo
    quedaba **subestimado en silencio**, sin ningún error visible en el dashboard. Con la
    agregación en SQL ese techo desaparece.
  - Se verificó que la migración corrió sin errores de sintaxis en la base real y se revisó
    manualmente que ambas funciones repliquen exactamente los mismos filtros que la lógica
    JavaScript que reemplazan (mismo rango de fechas, mismos `event_type`, mismo filtro de
    `slug`/`variant` para el test A/B). **No se pudo verificar visualmente el panel en
    `/dashboard`** porque requiere sesión y este entorno no tiene credenciales de login — quedó
    validado por revisión de código y por el build/tests, no por captura de pantalla (a
    diferencia del resto de los cambios de esta sesión, que sí se verificaron visualmente).
  - **Cerrado en un segundo incremento (2026-07-12)**:
    - **`/leads`** ya no trae un tope fijo de 300 filas sin forma de ver más atrás. Ahora pagina
      de verdad: `select("*", { count: "exact" })` + `.range()` (50 leads por página) con
      controles "Anterior/Siguiente" y "Página X de Y" que preservan los filtros activos
      (`status`/`channel`/`service`/`q`/`requires_human`) en la URL. El header también muestra el
      total real de leads (antes mostraba solo cuántos había en esa página).
    - **`/api/leads/export`** tenía un bug real más allá de "sin límite explícito": PostgREST (la
      API REST de Supabase) aplica su propio tope de filas por respuesta (`db-max-rows`, 1000 por
      default) que un `select("*")` sin `.range()` respeta **en silencio** — si los leads
      superaran ese número, la exportación se truncaba sin ningún aviso (mismo patrón de "conteo
      subestimado en silencio" que ya se había corregido para el dashboard). Corregido paginando
      con `.range()` en un loop hasta agotar los resultados, así el CSV siempre incluye todos los
      leads sin importar cuántos haya — sin necesidad de UI de paginación, porque una descarga
      sigue siendo un solo archivo.
    - No se pudo verificar visualmente `/leads` (requiere sesión, sin credenciales de login en
      este entorno) — validado por revisión de código, tests nuevos (incluido uno que reproduce el
      escenario de dos páginas de PostgREST para `/api/leads/export`) y build/tests.
  - **Aceptación cumplida**: tanto el listado como la exportación de leads escalan sin techo
    artificial ni truncamiento silencioso.

- [x] **TECH-01 — Deuda técnica y headers.** ✅ Resuelto (2026-07-12)
  - [x] `middleware.ts` → `proxy.ts`: renombrado siguiendo la convención de Next.js 16 (función
    `middleware()` → `proxy()`). El warning de deprecación que aparecía en cada arranque ya no sale
    (`npm run build` muestra `ƒ Proxy (Middleware)` en vez del aviso).
  - [x] **Bug real encontrado y corregido antes de mergear** (recién al verificar con un screenshot
    real, no solo con `npm run build`/`npm test`): la skill `vercel:nextjs` sugería
    `export const proxyConfig` para el matcher — es **incorrecto para Next.js 16.2.9**, ese export
    sigue llamándose literalmente `config` (confirmado leyendo
    `node_modules/next/dist/build/analysis/get-page-static-info.js`). Con `proxyConfig` el matcher
    no se reconoce y el proxy corre sobre *todas* las rutas, incluidos los assets de
    `_next/static` — rompía el CSS de todo el sitio (redirect 307 en cada request de CSS/JS).
    Además, `isPublicRoute` comparaba el pathname completo contra `PUBLIC_ROOT_PATHS` con match
    exacto, así que un archivo de metadata anidado bajo una landing (ej.
    `/cardiologa-lanus/opengraph-image`, agregado en SEO-01) no matcheaba y redirigía a `/login`
    sin sesión — se cambió a comparar por el primer segmento del path. Verificado con `curl` contra
    el dev server real: `/`, `/dashboard` sin sesión, `/privacidad`, todas las landings y sus
    `opengraph-image` devuelven el código esperado.
  - [x] Warnings de lint: `npm run lint` quedó en 0 problemas (antes había un warning de
    `ContentChannel` sin usar en `contenido/instagram/page.tsx`, import residual de cuando se sacó
    Google Business del frente — ver 2026-07-07 en `CLAUDE.md`).
  - [x] Vulnerabilidad de PostCSS: re-chequeada con `npm audit` — **sigue sin solución real**. Es una
    dependencia interna de `next` (`node_modules/next/node_modules/postcss`), no algo declarado en
    este proyecto. El rango vulnerable de Next según el propio advisory llega hasta
    `16.3.0-canary.5`, y hoy (`npm view next versions`) todavía no existe ningún `16.3.0` estable
    (solo canaries/previews) — no se debe adoptar una versión no estable en una app médica en
    producción. Sigue esperando a que Next libere un patch estable.
  - [x] **Headers de seguridad (2026-07-12, segundo incremento) — decisión deliberada de alcance**:
    se agregaron en `next.config.mjs` (`headers()`, aplicado a todas las rutas) `X-Content-Type-
    Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options:
    SAMEORIGIN` y un `Permissions-Policy` que solo deniega `camera`/`microphone`/`geolocation`
    (verificado que la app no usa ninguno de los tres) — nada de esto restringe scripts, estilos,
    ni orígenes de conexión. **A propósito no se agregó Content-Security-Policy**: es la parte que
    realmente puede romper en silencio el OAuth de Google/Instagram, Google Analytics, las fotos
    de Google Places o las imágenes de Supabase Storage, y armar un CSP correcto requiere poder
    probar cada integración de punta a punta — este entorno no tiene credenciales de login para
    completar ningún flujo de OAuth real. Los 4 headers elegidos, en cambio, no interactúan con
    ninguno de esos flujos (no son un allowlist de dominios, son comportamiento del navegador que
    no depende de qué esté permitido cargar) — se verificó visualmente con un dev server real
    (`/`, `/dra-lucia-chahin`, `/login`) que los headers están presentes en la respuesta y que el
    CSS/diseño/fuentes siguen cargando exactamente igual que antes.
  - **Aceptación cumplida para el alcance decidido**: lint/tests/build limpios, headers de
    seguridad básicos presentes sin romper nada verificable en este entorno. Un CSP completo queda
    como trabajo futuro explícito, a hacerse con acceso para probar OAuth de punta a punta.
  - [x] **Content-Security-Policy agregado (2026-07-18)** — la condición que lo bloqueaba (no poder
    probar login de punta a punta) ya no existía: este entorno local corre la suite E2E autenticada
    real. Header en `next.config.mjs` con inventario verificado archivo por archivo de lo que el
    navegador realmente carga: `script-src` self + gtag (con `'unsafe-inline'` — Next App Router
    inyecta scripts inline; el patrón de nonce vía proxy queda como mejora futura), `connect-src`
    self + Supabase (login/MFA del browser) + endpoints GA4, `img-src` self/data:/blob: + Supabase
    Storage + pixel GA, `frame-src 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`.
    En dev suma `'unsafe-eval'`+ws (Turbopack/HMR); en previews de Vercel permite `vercel.live`
    (toolbar). El OAuth de Google/Instagram no necesita permisos: son redirects top-level, que CSP
    no restringe. **Verificado contra un build de producción real**: header presente, landing sin
    errores de consola, y `npm run test:e2e` completo — los 3 tests autenticados (login+TOTP,
    dashboard, inbox, alta/edición/borrado de lead) y los 19 públicos pasan con el CSP activo.
    **Pendiente de chequeo post-deploy**: GA no se pudo probar en vivo (sin
    `NEXT_PUBLIC_GA_MEASUREMENT_ID` local) — la allowlist es la documentada oficial de GA4; si GA
    está activo en producción, mirar la consola del sitio real tras el deploy por si aparece una
    violación de CSP.

### Ola 4 — Derivación a humano sin alerta en tiempo real ✅ Resuelto (2026-07-15, incidente real 2026-07-14)

**Caso que originó esta Ola**: Seba compartió una captura del Inbox de un paciente ("David
Portas...", lead derivado a CIMEL Lanús) mostrando una mala experiencia real. El diagnóstico
inicial se armó en la nube (sin credenciales) con solo un fragmento de captura; esta sesión corre
local con `.env.local` real, así que pudo leer la conversación completa (24 mensajes) y los datos
de producción — el diagnóstico de abajo está confirmado contra la base real, no supuesto.

**Reconstrucción confirmada leyendo la conversación entera** (detalle clínico deliberadamente
omitido acá — este archivo se commitea a un repo público — ver hallazgo 1 para la naturaleza del
bug sin datos identificables):
1. El primer mensaje real del paciente incluía una lectura numérica de presión arterial elevada
   sobre un familiar, pidiendo atención con urgencia. El bot lo procesó como una consulta
   administrativa normal (le pidió la obra social) en vez de evaluarlo como posible urgencia — ver
   hallazgo 1.
2. El paciente escribió **cinco veces** pidiendo hablar con una persona (variantes como "prefiero
   una persona del equipo" o solo "persona") antes de que el bot reconociera el pedido — el regex
   de `hablar_con_humano` solo matcheaba la frase exacta "hablar con alguien/una persona/un
   humano" — ver hallazgo 3.
3. Confirmado que `escalateToHuman()` solo guardaba en la base sin avisar a nadie en tiempo real —
   la respuesta humana llegó ~6.5 horas después. Ya resuelto (ver P0 abajo).
4. Verificado en la conversación real que el bug de PR #78 (respuesta manual no se mandaba por
   WhatsApp) ocurrió exactamente en este caso a las 23:00 del 14/07 — el mensaje de Lucía
   apologizando por el bot quedó guardado con `role: "user"` y generó una respuesta de IA confundida
   sobre su propio texto. El siguiente intento (23:16, después de mergear PR #78) ya funcionó bien.
   El bot siguió respondiendo después de eso (PR #79 — pausa automática — mergeó recién a las
   23:34, después de estos mensajes).

**Hallazgos nuevos de esta sesión, además del plan original**:

1. **[MEDIO-SEGURIDAD] El detector de urgencias médicas no reconocía un valor numérico de
   presión.** `isEmergencyMessage()` (`medical-safety.ts`) tenía frases fijas ("presión muy alta",
   "presión alta con") pero un mensaje real daba directamente el número (una lectura ≥180, rango de
   crisis hipertensiva) sin usar ninguna de esas frases — no matcheaba nada. **Corregido**: se
   agregó un patrón que detecta cualquier valor de presión ≥140 mencionado cerca de la palabra
   "presión" (`HIGH_BLOOD_PRESSURE_PATTERN`), más la frase "pico de presión". Tests nuevos con un
   mensaje sintético equivalente (no el texto real del paciente) y controles negativos (120, 130 no
   disparan).
2. **[ALTO] El primer mensaje con contenido real de toda conversación nueva se perdía para
   siempre.** `logWhatsAppMessage()` solo inserta en `messages` `if (params.leadId)` — la columna
   es `NOT NULL`. Como el lead recién se crea *después* de procesar la primera respuesta del
   paciente (en `upsertLeadFromIntake`/dentro de `escalateEmergency`), ese mensaje se logueaba con
   `leadId: null` y directamente no se guardaba en ningún lado (ni siquiera con lead_id null —
   la inserción entera se salteaba). Esto no era específico de este incidente: pasa en **toda**
   conversación nueva del bot. Explica por qué el Inbox mostraba la conversación arrancando a
   mitad de camino, sin ningún contexto previo visible. **Corregido**: `upsertLeadFromIntake()` y
   `escalateEmergency()` ahora
   insertan retroactivamente ese mensaje en `messages` apenas se crea el lead real. No recupera el
   histórico ya perdido (el texto nunca se guardó en ninguna tabla, solo un resumen truncado quedó
   en `lead.general_reason`/`handoff_events.summary`), pero corta la pérdida hacia adelante. Tests
   nuevos (`whatsapp-bot-message-recovery.test.ts`) cubren ambos casos (intake y emergencia) y que
   NO se duplica el insert cuando el lead ya existía de antes.
3. **[MEDIO] El regex de `hablar_con_humano` era demasiado estricto.** Solo matcheaba "hablar con
   alguien/una persona/un humano" literal. **Corregido**: se amplió para cubrir "prefiero/quiero/
   necesito ... persona/humano/alguien" en cualquier orden, y un mensaje que es solo esa palabra
   suelta (`whatsapp-intents.ts`). Tests con las frases reales del incidente.

**Plan de corrección — todo implementado y verificado**:

- [x] **P0 — Alerta en tiempo real al derivar a un humano.** `sendHandoffAlert()` nueva en
  `alert-email.ts` (mismo mecanismo de Resend, sin infraestructura nueva), llamada desde
  `escalateToHuman()` con nombre/teléfono/motivo/resumen y link directo a `/inbox?lead_id=...`.
  Throttle de 30 min por lead (no manda un mail por cada mensaje de una conversación larga).
- [x] **P0 — Recordatorio si nadie respondió el handoff.** `runHandoffReminderCheck()` corre dentro
  del cron diario ya existente (`publish-content`, sin sumar un tercer cron — Vercel Hobby sigue en
  2) y manda un único mail con todos los handoffs sin resolver hace más de 60 minutos. **Aclaración
  honesta**: al ser un cron diario (Vercel Hobby no permite más frecuencia sin sumar un cron nuevo),
  esto funciona como red de seguridad ante la alerta puntual perdida/ignorada, no como un
  recordatorio fino a los 30-60 min.
- [x] **P1 — Fallback inmediato en el mensaje de derivación.** Cuando el bot conoce la sede
  preferida del paciente, el mensaje de "te derivamos con una persona" ahora suma el teléfono (o
  link de Swiss Medical) de esa sede como alternativa inmediata.
- [x] **P2 — Visibilidad priorizada en el Inbox/`/leads`.** Los leads con `requires_human = true`
  ahora aparecen primero (Inbox) u ordenados por tiempo de espera real (`/leads?requires_human=true`),
  con un badge rojo "Esperando hace Xh". Verificado visualmente con datos reales de producción.
  De paso, **el handoff ahora se resuelve solo**: cuando el equipo responde de verdad desde el
  Inbox (PR #78), `resolveHandoffForLead()` limpia `requires_human` y marca el `handoff_events`
  como resuelto — antes quedaba marcado "requiere humano" para siempre, sin ningún mecanismo que lo
  sacara de la lista (confirmado: el caso de David Portas seguía marcado 19h después aunque Lucía
  ya le había respondido varias veces — se resolvió a mano ese caso puntual con aprobación
  explícita de Seba, como backfill único).
- [x] Migración `20260714_whatsapp_bot_pause.sql` (pendiente de la sesión anterior) aplicada en
  producción.

Verificado: `npm test` (344/344), lint y build sin errores. Verificado visualmente con Playwright y
el usuario E2E dedicado contra datos reales de producción (Inbox, `/leads?requires_human=true`,
conversación completa de David Portas) — capturas borradas después de revisarlas (contienen PII de
un paciente real, no se commitean).

### Secuencia y reglas de ejecución

1. Ejecutar `WA-01` a `WA-03` en una misma iniciativa, con migración reversible y preview verificado.
2. Ejecutar `DATA-01`/`DATA-02` antes de ampliar captación o conectar nuevas cuentas externas.
3. Implementar `SEC-01`, `SEC-02`, `OPS-01` y `QA-01` antes del nuevo funnel de atribución.
4. Construir `GROWTH-01` y validar datos reales antes de sumar más experimentos o dashboards.
5. Cerrar con UX/SEO/rendimiento, guiado por métricas y QA visual.

Este plan no incluye cambios a clasificación de síntomas, mensajes de alarma ni otros guardrails
médicos. Si una implementación futura necesita tocarlos, aplica la pausa obligatoria con preview y
aprobación explícita antes de mergear.

---

## Etapa 1 — Infraestructura y CRM ✅

Herramientas internas de la app para gestionar leads, contenido y seguimiento.

- [x] CRM: lista de leads con filtros por estado, canal y servicio
- [x] CRM: carga manual de leads (`/leads/nuevo`)
- [x] CRM: detalle de lead con historial de mensajes
- [x] CRM: acciones rápidas "Ya pidió turno" y "No pudo pedir" desde detalle e inbox
- [x] CRM: seguimiento automático +24h al crear lead desde formulario público
- [x] CRM: export CSV de leads con todos los campos
- [x] Inbox: conversación por lead con respuesta automática IA
- [x] Inbox: botón "Sugerir mensaje de seguimiento" con IA (`/api/ai/suggest`)
- [x] Clasificador IA configurable (Gemini / Claude) con fallback automático
- [x] Dashboard: KPIs de conversión (total leads, confirmados, seguimiento pendiente, urgencias)
- [x] Dashboard: leads por canal de origen (Google Maps, Instagram, Google Search, WhatsApp, manual)
- [x] Dashboard: leads por servicio solicitado y por institución preferida
- [x] Dashboard: métricas de landings (clicks CIMEL, clicks Británico, clicks Swiss, formularios enviados)
- [x] Sumado Hospital Británico como tercera sede de derivación (miércoles), junto a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes) — tipos, prompts de IA, bot de WhatsApp, landings y dashboard
- [x] Estudio de contenido: generador de posts/reels/carruseles con IA, fuentes y placas visuales
- [x] Rate limiting por IP en APIs públicas (anti-spam básico)
- [x] CI: lint + build automático en cada push a main (GitHub Actions)

---

## Etapa 2 — Web pública: /dra-lucia-chahin

La página pública principal. Activo central de captación — punto de llegada desde
Google Maps, Instagram, WhatsApp y búsqueda orgánica.

### Implementado ✅
- [x] Página pública en `/dra-lucia-chahin` accesible sin login
- [x] Hero con nombre, especialidad e intro de la doctora
- [x] Sección servicios: consulta cardiológica, ecocardiograma, control, evaluación cardiovascular
- [x] Sección "Dónde atiende": CIMEL Lanús — martes / Hospital Británico — miércoles / Swiss Medical Lomas — viernes
- [x] CTAs expandibles con instrucciones paso a paso para pedir turno en cada institución
- [x] Captura de UTM source/medium/campaign/content (se usa en los eventos `cta_cimel`/`cta_britanico`/`cta_swiss`)
- [x] Aviso médico visible: no reemplaza consulta, no apta para urgencias, llamar al 107
- [x] Bloque "Sobre la doctora" (contenido básico)

### Profesionalización pendiente ⏳
- [x] Foto profesional de la Dra. Lucía Chahin en el hero — guardar como `public/lucia-chahin.jpg` *(foto recibida, pendiente de subir al servidor)*
- [x] Número de matrícula (MN o MP) visible junto al nombre — cargada por Lucía en Configuración > Datos de la doctora el 2026-07-05 (MN 176700), visible en hero, "Sobre la doctora", footer y JSON-LD
- [x] FAQ: preguntas frecuentes sobre turnos, servicios, cobertura y sedes — 11 preguntas en la landing principal + FAQ corta específica en cada landing SEO
- [x] Links directos a Google Maps para CIMEL Lanús y Swiss Medical Lomas *(pendiente: link de Google Maps del Hospital Británico en Configuración)*
- [x] Botón de WhatsApp con mensaje prearmado según sede (+5491178285006) — en cada card de sede (sección "Pedir turno") y en cada landing SEO
- [x] Dominio propio — `draluciachahin.ar` registrado en NIC Argentina (1/7/2026)

### Rediseño de conversión (2026-07-04, brief basado en `deep-research-report.md`)
- [x] Hero con CTA primario "Pedir turno" + secundario "Ver sedes y horarios" + chips de confianza
- [x] Nav de anclas fijo (Servicios · Sedes · Obras sociales · FAQ · Pedir turno) en la landing principal
- [x] CTA sticky en mobile ("Pedir turno con la Dra. Chahin") en todas las landings
- [x] Cards de sede con botones de acción reales: "Pedir turno online" (si hay `booking_url` cargado, ej. Swiss Medical), "Llamar" (`tel:`) y "Consultar por WhatsApp" (`wa.me`) — antes eran solo texto/instrucciones sin acción directa
- [x] Servicios como cards con microcopy orientado a síntomas/motivo de consulta
- [x] Sección "Obras sociales y formas de atención" — muestra coberturas cargadas por sede en Configuración, o mensaje honesto invitando a consultar si todavía no hay datos cargados *(ya cargadas por sede — ver "✍️ Contenido para cargar/publicar", verificado 2026-07-17)*
- [x] Sección "Opiniones de pacientes" — reseñas reales de Google vía Places API (New) desde el 2026-07-04 (`GOOGLE_PLACES_API_KEY` + `GOOGLE_PLACE_ID`, ver CLAUDE.md). Cae al placeholder honesto si la API no está disponible.
- [x] JSON-LD: `Physician` + `FAQPage` en todas las landings, `BreadcrumbList` en landings SEO, `identifier` (matrícula) cuando esté cargada *(pendiente: `MedicalClinic` por sede)*
- [x] Eventos de analítica ampliados (2026-07-06) — `landing_events` ahora también registra `page_view` (una vez por carga de landing) y clicks separados por acción (`click_booking`/`click_call`/`click_whatsapp`/`click_maps`) con `location_key` por sede, además de los `cta_*` históricos que se mantienen para no romper las métricas globales existentes. El link "Cómo llegar" no trackeaba nada antes; ahora sí.

### Revertido (2026-07-04)
- [x] ~~Formulario "No pude pedir turno" en las landings~~ — se sacó de la web pública. Creaba un lead `seguimiento_pendiente` prometiendo "te ayudamos", pero **hoy nadie revisa el CRM/Inbox** para mandar ese seguimiento manual (`/api/followup` requiere que un usuario logueado lo dispare a mano). Mostrar el formulario sin nadie contestando es peor que no tenerlo. Quedan solo los canales que responden solos: llamar y el bot de WhatsApp. El backend (`/api/public/lead`, con el campo `insurance` ya soportado) queda intacto sin uso — reactivar cuando haya alguien asignado a hacer el seguimiento manual, o cuando se automatice la respuesta por WhatsApp (Etapa 7).

### Acciones externas (las hace Lucía)
- [x] Configurar `/dra-lucia-chahin` como link de la bio en Instagram — hecho vía dominio propio `draluciachahin.ar`, ver Etapa 5
- [x] ~~Configurar `/dra-lucia-chahin` como sitio web en Google Business Profile~~ **Resuelto** —
  duplicado del ítem ya confirmado más abajo (Etapa 4, 2026-07-11): el sitio web del perfil ya
  apunta a `https://draluciachahin.ar/`.

### Decisión pendiente: Google Cloud — fin de la prueba gratuita (~90 días desde 2026-07-04)
El proyecto de Google Cloud usado para Places API (reseñas) quedó en modo prueba gratuita
($300 de crédito, 90 días) a propósito: mientras esté en prueba, Google no puede cobrar nada
aunque se supere el crédito, solo pausa el servicio. Como respaldo para cuando eventualmente
se decida activar la cuenta completa, ya se armó un corte automático de facturación
(tema de Pub/Sub `presupuesto-alertas` → Cloud Run function `cortar-facturacion` → presupuesto
de $1/mes que la dispara). Sin uso real, no hay apuro en activar.
- [ ] Revisar antes de que venza la prueba (~inicios de octubre 2026): decidir si se activa la
      cuenta completa (necesario si se quiere seguir mostrando reseñas de Google después de esa
      fecha) o se deja pausar solo. Si se activa, confirmar que el corte automático de
      facturación sigue funcionando.

---

## Etapa 3 — Landings SEO locales

6 páginas con keyword local, una por combinación de servicio + sede. Generan tráfico
orgánico de búsqueda y convierten con instrucciones claras para pedir turno.

### Implementado ✅
- [x] `/cardiologa-lanus` — Cardióloga en Lanús
- [x] `/cardiologa-lomas` — Cardióloga en Lomas de Zamora
- [x] `/ecocardiograma-lanus` — Ecocardiograma en Lanús
- [x] `/ecocardiograma-lomas` — Ecocardiograma en Lomas de Zamora
- [x] `/consulta-cardiologica-lanus` — Consulta cardiológica en Lanús
- [x] `/consulta-cardiologica-lomas` — Consulta cardiológica en Lomas de Zamora
- [x] Contenido único por landing: título, intro, instrucciones y sede específica
- [x] Metadata SEO única por landing: title, description, canonical, OG, Twitter card
- [x] `sitemap.xml` generado automáticamente (todas las landings)
- [x] `robots.txt` con rutas públicas permitidas y rutas internas bloqueadas
- [x] Link a `/dra-lucia-chahin` desde cada landing SEO

### Pendiente
- [x] FAQ específica por landing (preguntas frecuentes distintas por servicio/sede)
- [x] Links internos entre landings (ej. Lanús → Lomas y viceversa, para SEO)
- [x] Datos estructurados JSON-LD (Physician, FAQPage, BreadcrumbList) *(MedicalClinic por sede pendiente)*
- [ ] ~~Formulario "No pude pedir turno" en cada landing SEO~~ — revertido, ver nota en Etapa 2

### Acciones externas (las hace el equipo)
- [x] ~~Configurar Google Search Console con el sitemap~~ ver "✍️ Contenido para cargar/publicar"
      más arriba — resuelto (2026-07-17)
- [ ] Verificar indexación de las 8 páginas públicas en Search Console (7 + `/cardiologa-caba`
      nueva) — pendiente real, ver más arriba (tarda días, no es instantáneo)

---

## Etapa 4 — Google Business Profile

Ficha de Google que aparece en Google Maps y búsqueda local. Es el canal con mayor
intención de turno: quien busca "cardióloga en Lanús" tiene alta probabilidad de pedir.

### Módulo en la app ✅
- [x] Checklist de configuración del perfil con ítems priorizados
- [x] Checklist: 5 de 14 items se auto-detectan leyendo el perfil real de Google en cada carga
      (nombre, descripción, horario del martes, link a la landing, teléfono) — quedan no-editables
      con badge "Detectado automáticamente" mientras Google esté conectado; si se desconecta, caen
      de vuelta al valor manual guardado (2026-07-07). Los 9 restantes (categorías, fotos, Q&A,
      pin del mapa, servicios, y 2 que en realidad son de Instagram) no tienen forma de verificarse
      por API — ver `src/lib/google-business.ts` → `computeChecklistAutoStatus`.
- [x] Publicaciones: generador con IA + modo manual (copiar y pegar)
- [x] Reseñas: sugerencias de respuesta con IA
- [x] Perfil: editar descripción, horarios, teléfono y sitio web
- [x] Conexión OAuth con Google Business Profile API

### Acciones externas pendientes (las hace Lucía o el equipo)
- [x] Crear o reclamar el perfil "Dra. Lucía Chahin" en Google Business — verificado (confirmado 2026-07-11, ícono azul "Verificada")
- [x] Completar perfil: foto, horarios, descripción — confirmado 2026-07-11 (13 reseñas 5,0★, foto y descripción cargadas)
- [x] Configurar sitio web del perfil → confirmado 2026-07-11: `https://draluciachahin.ar/` (la raíz redirige a `/dra-lucia-chahin` para visitantes sin sesión, ver `src/middleware.ts`)
- [x] Atribuir consultas iniciadas desde el botón de chat de Google Maps/Búsqueda: el mensaje
      configurado con `Ref: MAPS-GRAL-01` queda reconocido por el bot y el lead se guarda con
      `utm_content = MAPS-GRAL-01` y `landing_page = google-maps` (2026-07-18).
- [x] ~~Evaluar si crear ficha separada para Swiss Medical Lomas~~ **Decidido (2026-07-17):** no,
  se mantiene una sola ficha ("Dra. Lucía Chahin") para las 3 sedes.
- [ ] Definir estrategia de reseñas: cómo y cuándo pedirlas a pacientes actuales

### Pendiente: cuota 0 en la GBP API (bloquea Perfil/Publicaciones/Reseñas dentro de la app)
Las pestañas **Perfil**, **Publicaciones** y **Reseñas** de Google Local muestran "cuota API = 0" /
"Falta Account ID". Confirmado 2026-07-05: el proyecto de Google Cloud (`app-lule`) tiene cuota 0 por
defecto en `mybusinessbusinessinformation.googleapis.com` y `mybusinessaccountmanagement.googleapis.com`
(`RESOURCE_EXHAUSTED`, `quota_limit_value: "0"`) — es una restricción anti-abuso de Google en todos los
proyectos nuevos, **no tiene costo**, solo requiere pedir acceso.
- [x] **Corregido y solicitado 2026-07-12**: no se pide desde Cloud Console → Cuotas (ese
      formulario de "Editar cuota" redirige a una página de Google que confirma que el formulario
      legacy de aumento de cuota está cerrado). El camino real fue
      `support.google.com/business/contact/api_default` → **"Application for Basic API Access"**
      → un formulario dedicado de Google (`developers.google.com/my-business`, no el de contacto)
      con datos del proyecto (`app-lule`) y de la empresa. Solicitud enviada, caso de asistencia
      **`2-7574000041506`**, revisión estimada 7-10 días hábiles. Mientras se resuelve, editar
      perfil/posts/reseñas desde el panel oficial de Google Business directamente (los links "Ir a
      Google Business" en cada tab).

---

## Etapa 5 — Instagram

Canal de entrada principal junto con Google Maps. Genera confianza y deriva al sitio
público para pedir turno.

### Módulo en la app ✅
- [x] Estudio de contenido: generador de posts, reels y carruseles con IA
- [x] Tab "Bio y Fijados": plantillas de bio, 3 posts fijados, historias destacadas y CTAs correctos

### Acciones externas pendientes (las hace Lucía)
- [x] Actualizar bio de Instagram con el texto sugerido en la app — confirmado en producción (@draluciachahin) 2026-07-07
- [x] Cambiar el link de la bio a `/dra-lucia-chahin` — usa el dominio propio `draluciachahin.ar`
- [x] ~~Publicar los 3 posts fijados (cómo pedir turno / servicios / dónde atiende)~~ ver
  "✍️ Contenido para cargar/publicar" más arriba — resuelto (2026-07-17)
- [x] ~~Crear las 7 historias destacadas: Turnos · CIMEL · Hospital Británico · Swiss ·
  Ecocardiograma · Cardiología · FAQ~~ ver "✍️ Contenido para cargar/publicar" más arriba —
  resuelto con 3 destacadas por sede (2026-07-17), el resto queda opcional no bloqueante
- [ ] Establecer ritmo de publicación mensual: 2-3 conversión + 4-6 educativo + 2-3 local — es una
  decisión editorial (qué mezcla de temas generar/aprobar en Biblioteca), no un gap de código: la
  app ya deja fijar "veces por semana" por track (posts/historias/carrusel) en "Publicación
  automática", pero no fuerza una mezcla de categorías — eso lo decide quien aprueba cada pieza.

### Automatización (Etapa 7)
- [x] Publicar contenido aprobado directamente desde la app vía Instagram Graph API — primer post real
      confirmado en producción 2026-07-07 (@draluciachahin).
- [x] Publicación directa de carruseles (2026-07-11) — antes solo post/historia podían auto-publicarse;
      ahora un carrusel genera una imagen por slide (además de la portada) y se publica con el flujo real
      de Meta (contenedor por imagen → contenedor `CAROUSEL` → publish). Ver `docs/CONTENT_STUDIO.md` →
      "Carruseles". El reel sigue siendo la única excepción (requiere video real, sin soporte).

---

## Etapa 6 — Tracking y métricas

### Implementado ✅
- [x] Captura de UTM en todos los leads (source, medium, campaign, content)
- [x] Campos de tracking por interacción: clicked_cimel_cta, clicked_swiss_cta, booking_instruction_viewed
- [x] Registro de eventos de landing: cta_cimel, cta_swiss, form_started, form_submitted
- [x] Dashboard con métricas de conversión global
- [x] Tasa de conversión: confirmaron turno / total leads

### Implementado ✅ (2026-07-06)
- [x] Dashboard por landing: visitas y interacciones por slug (`/dashboard` → "Ranking de landings"),
      ordenado por tasa de interacción. *Nota honesta: no es "leads generados" en sentido estricto —
      el formulario público que hubiera atribuido un lead a un slug está revertido (ver Etapa 2), así
      que hoy no hay un canal real que genere leads atribuibles a una landing puntual. Se usa
      visitas + clicks en pedir turno/llamar/WhatsApp/cómo llegar como proxy de interés real.*
- [x] Ranking de landings por efectividad — mismo tablero, ordenado por tasa de interacción.

### Pendiente
- [x] Google Analytics: integración para visitas y sesiones por página (2026-07-07) — script GA4
      (`src/components/google-analytics.tsx`) inyectado en la landing principal y las 6 landings SEO,
      no en el CRM interno. *Falta la acción externa: crear la cuenta/propiedad GA4 y cargar
      `NEXT_PUBLIC_GA_MEASUREMENT_ID` (ver CLAUDE.md → "Google Analytics — cómo activarlo"). Sin eso
      no se inyecta ningún script, no bloquea nada.*
- [x] Métricas por campaña UTM: vincular contenido generado con leads captados — cada pieza del
      Estudio de contenido tiene un "Link de seguimiento" (`/api/content/track/[itemId]`) que redirige
      a `/dra-lucia-chahin` con `utm_content=<id>`; Biblioteca y el editor muestran visitas/interacciones
      atribuidas a esa pieza. *Limitación real: Instagram no permite links clickeables en posts de feed,
      así que solo sirve para historias (link sticker) o para pegarlo en la bio/Linktree — no hay forma
      de atribuir un post de feed común sin ese link.*
- [x] Reorganización visual del dashboard (2026-07-13): `/dashboard` agrupado en secciones
      ("Pacientes y leads", "Sitio web y landings", "WhatsApp", "Instagram", "Reportes"), más
      "Visitas al sitio" (KPI consolidado) y "Costo de WhatsApp" (7d/30d + link a `/costos`) —
      ver CLAUDE.md para el detalle completo.
- [x] Dashboard de crecimiento temporal y atribución multicanal (2026-07-13): selector
      7/30/90/365 días, comparación contra período anterior, serie visita → acción → lead → turno,
      embudo, canales, acciones web, ranking/experimentos en la misma ventana, insights de cuenta de
      Instagram, métricas/reputación de Google y enlaces medibles `/go/instagram` + `/go/google`.
      `landing_events.session_id` deduplica acciones por sesión anónima; las RPC agregan en SQL sin
      descargar eventos crudos. Los snapshots nuevos comparten `publish-content`, sin tercer cron.
- [x] **Insights por post de Instagram** (reach, likes, comments) ✅ Resuelto (2026-07-17) —
      evaluado el 2026-07-13, bloqueado por no persistir el `mediaId`. Ahora `content-publish.ts`
      captura el `mediaId` que ya devolvía `publishContainer()` y lo guarda como
      `instagram_media_id` en la pieza (`content_pipeline`, mismo mecanismo que el resto de los
      campos — no hizo falta tabla nueva). `getInstagramMediaInsights()` en `instagram-business.ts`
      pide reach/likes/comments/guardados/compartidos igual que `getInstagramAccountInsights()`
      (cada métrica por separado, para que una no habilitada no tape las demás). Se piden **en
      vivo, a pedido** (botón "Ver insights de Instagram" en cada card publicada de Biblioteca,
      `GET /api/content/insights/[itemId]`) en vez de guardar un historial — evita pegarle a la API
      de Meta en cada carga de la página. Solo disponible para piezas publicadas por este sistema
      desde ahora en adelante; las publicadas antes no tienen `instagram_media_id` guardado.
      Verificado con `npm run build`/`lint`/`test` (820/820) — no se pudo probar contra la cuenta
      real de Instagram en este entorno (sin credenciales de Meta acá).
- [x] **Tendencia de rating/reseñas de Google + Performance API** (2026-07-13): rating y cantidad
      de reseñas se toman de Places API, que ya funcionaba y no depende de la cuota de GBP. La tabla
      `google_business_snapshots` también está preparada para impresiones Search/Maps, clicks al
      sitio, llamadas y direcciones de Business Profile Performance API. Mientras Google mantenga
      cuota 0 guarda `quota_blocked` y lo explica en el dashboard; cuando habilite acceso, comienza a
      poblar las métricas automáticamente sin otro cambio ni otro cron.

---

## Etapa 7 — Automatización

- [x] Arquitectura de costos de WhatsApp Business Platform (2026-07-04): tracking de mensajes/costo
      por categoría (`whatsapp_pricing_rules`, `whatsapp_cost_events`), ventana de 24h + Free Entry
      Point (Click-to-WhatsApp), gate de template fuera de ventana, `templates` (9 obligatorios,
      **ya aprobados en Meta**), `consent_records`, `handoff_events`, intents cerrados con reglas
      primero e IA de respaldo opcional, modo ahorro y flag de simulación del cobro de octubre
      2026, dashboard `/costos`, suite de tests con Jest (nueva en el proyecto). Detalle en
      `CLAUDE.md` → "Costos de WhatsApp y templates" — **falta confirmar** que el `$0` (tarifa
      pública de Meta para Argentina) haya quedado guardado en `Configuración → Precios de
      WhatsApp` (se cargó de forma provisoria el 2026-07-07, sin confirmar si se llegó a guardar).
- [x] WhatsApp Business API: envío automático de mensajes de seguimiento (2026-07-07) — leads sin
      confirmar turno reciben el template `recontacto_incompleto` vía `sendTemplate`, corriendo dentro
      del cron de `publish-content` (sin cron propio, para no superar el límite de 2 crons del plan
      Hobby de Vercel). Ver `src/lib/whatsapp-followup.ts` y `CLAUDE.md` → "Seguimiento automático de
      leads por WhatsApp". Los 9 templates obligatorios (incluido `recontacto_incompleto`) ya están
      **aprobados en Meta** desde el 2026-07-07 — este flujo ya puede mandar mensajes reales, no
      sigue bloqueado. Los demás templates (`recordatorio_turno`, `seguimiento_post_consulta`, etc.)
      siguen sin automatizar porque necesitan una fecha de turno real que la app no gestiona.
- [ ] *(Descartado por ahora, 2026-07-17)* Configurar `WHATSAPP_VERIFY_TOKEN` en `.env.local` + webhook de prueba separado (vía ngrok) para testear localmente cambios en la lógica de recepción de mensajes (`src/lib/whatsapp-bot.ts`) sin tocar el webhook de producción. Seba confirmó que no hace falta armarlo por adelantado — se retoma el día que haya un cambio real de esa lógica en curso.
- [x] Instagram Graph API: publicación directa desde la app del contenido aprobado (2026-07-06/07) —
      manual ("Publicar ahora" y botones por canal en el editor) y automática (Vercel Cron diario,
      dos cronogramas independientes: posts de feed y historias, cada uno con su propia frecuencia
      "veces por semana"). Ver `src/lib/content-publish.ts`, `src/app/api/cron/publish-content/`,
      `docs/CONTENT_STUDIO.md` → "Publicacion automatica".
- [x] ~~Automatización de flujos de seguimiento con n8n~~ **Superado** — la necesidad real (reintentar
      contacto con leads sin confirmar turno) ya está resuelta arriba con `whatsapp-followup.ts`
      corriendo dentro del cron de `publish-content`, sin sumar n8n ni un tercer cron. Mismo criterio
      ya aplicado para las alertas de cron (ver "[FEATURE] Alerta proactiva..." más abajo): los flujos
      repetitivos de este proyecto corren directo en Vercel Cron, no hace falta una herramienta aparte.
- [x] Reportes automáticos semanales (2026-07-06, movido a domingo 2026-07-07) — cron semanal
      (`/api/cron/weekly-report`, domingo 08:00 UTC = 05:00 ART) calcula leads nuevos, confirmados,
      tasa de conversión, canales y visitas/interacciones
      de landing de los últimos 7 días y los guarda en `weekly_reports`; se ven en `/dashboard` →
      "Reportes semanales". *No se envía por WhatsApp/email de forma proactiva — ese canal no existe
      todavía (requeriría un template de WhatsApp aprobado por Meta), así que queda para consultar en
      la app en vez de mandarse solo.*
- [x] Vincular campañas UTM con el contenido del estudio para saber qué pieza genera leads — ver nota
      en Etapa 6 (link de seguimiento por pieza)
- [x] Carga manual de piezas en Estudio de contenido (2026-07-07) — botón "Crear pieza en blanco" en
      Biblioteca abre el editor con todos los campos vacíos para completar 100% a mano, sin generar con
      IA; se puede subir una imagen propia (`/api/content/upload-image`, mismo bucket `content-media` que
      las placas de Gemini) y aprobar directamente para que entre a la cola de publicación.
- [x] Fecha de inicio programable por track de "Publicación automática" (2026-07-07) — Posts de feed e
      Historias tienen cada uno un control "Empezar: Ahora / fecha programada" (`starts_at` en
      `AutoPublishTrackSettings`); si se elige una fecha futura, el cron no publica nada de ese track
      hasta llegar a esa fecha, aunque ya haya piezas aprobadas en cola.

---

## Etapa 8 — Escalamiento

- [ ] Google Search Console: monitorear keywords, indexación y clics
- [ ] Google Analytics: visitas, sesiones, tasa de rebote y conversión por página
- [ ] Google Ads: campañas de búsqueda pagada para Lanús y Lomas de Zamora
- [x] A/B testing de landings (2026-07-07) — primer test real en producción: la landing principal
      (`/dra-lucia-chahin`) asigna automáticamente, por cookie (`lule_hero_variant`, 90 días), cuál de
      los dos botones del hero es primario — "Pedir turno" (variante A, control) o "Ver sedes y
      horarios" (variante B). Asignación 50/50 en `middleware.ts`, sin cuenta de usuario ni backend de
      experimentos: el visitante siempre ve la misma variante mientras dure la cookie. Resultados en
      `/dashboard` → "Test A/B: hero de la landing principal" (visitas, clicks por botón e
      interacciones downstream por variante, últimos 90 días). *Alcance a propósito: solo la landing
      principal (las 6 landings SEO tienen un hero más simple, de un solo botón, sin tocar) y un solo
      test a la vez — no se construyó una plataforma de experimentos genérica todavía. No hay ganador
      automático: hay que mirar la tabla y decidir a mano cuándo cortar el test.* Ver
      `src/middleware.ts`, `src/app/landings/[slug]/page.tsx`, `src/app/landings/[slug]/hero-cta-link.tsx`,
      `src/lib/landing-track.ts`, migración `20260707_landing_events_variant.sql`.
- [x] Sistema de recomendaciones de crecimiento (2026-07-07) — motor de reglas simples (sin ML) sobre
      datos que la app ya junta en 4 canales, mostrado en `/dashboard` → "Recomendaciones de
      crecimiento". Cada regla es pura y está testeada por separado (`src/lib/growth-recommendations.ts`,
      38 tests): **web** (landing con muchas visitas y baja interacción, landing sin ninguna visita,
      sede sin obras sociales cargadas, señal para cortar el test A/B del hero), **WhatsApp** (costo
      proyectado sobre el presupuesto, templates sin aprobar, conversaciones abandonadas sin derivar),
      **Instagram** (no conectado, publicación automática apagada, última corrida con error, track
      activado que no publica hace más de 21 días) y **Google Maps** (reseñas no configuradas, pocas
      reseñas, rating bajo, Google Business no conectado). *Sin acción automática — cada recomendación
      es informativa, la decisión la sigue tomando una persona.* No incluye Google Search Console/Ads
      ni tasa de rebote de GA (esos dos ítems de arriba siguen pendientes, son acciones externas de
      configuración, no datos que la app ya tenga).

---

## Pendientes — sin sesión asignada

### [TECH] ✅ Resuelto (2026-07-06): `createServiceClient()` vs `getServiceDb()`
Se auditaron y migraron las ~14 rutas restantes que usaban `createServiceClient()` (todas las de
`google-business/*` e `instagram-business/*` que faltaban, `public/click`, `public/lead`, y la landing
pública `src/app/landings/[slug]/page.tsx`) a `getServiceDb()`. Como ya no queda ningún uso real, se
**eliminó por completo** la función `createServiceClient()` de `src/lib/supabase/server.ts` para que no
se pueda volver a usar por error. Regla documentada en `CLAUDE.md` → "Cliente de Supabase con
service_role — usar siempre `getServiceDb()`, nunca un cliente con cookies".

### [TECH] ✅ Resuelto (2026-07-07): reintentar publicación duplicaba posts en el canal que ya había salido bien
`resolveChannelsToPublish` intersectaba canales pedidos vs. habilitados pero no miraba
`auto_publish_result`, así que reintentar tras una publicación parcial (ej. Instagram OK, Google
Business falló) volvía a publicar también en el canal ya exitoso. Afectaba al cron y a "Publicar
ahora" (este último ni siquiera llamaba a la función). Se corrigió para excluir canales con resultado
`"published"` — ver `src/lib/content-pipeline.ts`.

### [BACKLOG] Instagram Business Discovery — en standby (2026-07-11)
Se investigó traer datos públicos de otras cuentas de Instagram (caso concreto: @cinme.ar, CIMEL Lanús)
vía Business Discovery. Confirmado que ese campo no existe en `graph.instagram.com` ("Instagram API with
Instagram Login", lo que usa este proyecto) — probado tanto contra @cinme.ar como contra la propia cuenta
conectada (@draluciachahin), mismo error en ambos casos, descartando que sea tema de permisos. Es
exclusivo de la Instagram Graph API clásica, que requiere vincular una Facebook Page a la cuenta de
Instagram (algo que este proyecto evita a propósito). El scope `instagram_business_manage_insights` y
`getBusinessDiscovery()` en `src/lib/instagram-business.ts` quedaron agregados igual (inofensivos, sirven
si algún día se retoma), pero no resuelven esto sin ese cambio de arquitectura.

**Si se retoma más adelante, camino concreto (no urgente, decisión del usuario 2026-07-11 fue dejarlo en
standby):**
1. (Acción externa, la hace Lucía/Seba) Crear una cuenta personal de Facebook si no hay una, crear una
   Página de Facebook para la práctica, vincular el Instagram profesional de Lucía a esa Página, y
   agregar esa cuenta de Facebook como Administradora/Tester en la app de Meta ya existente (mismo
   mecanismo por el que Instagram publica hoy sin necesitar App Review completo).
2. (Código) Flujo de login **nuevo y separado** con Facebook Login (`graph.facebook.com`) — no reemplaza
   ni toca el login de Instagram actual, que sigue publicando igual. Guardar el token de la Página en
   claves nuevas de `app_config`. Reescribir `getBusinessDiscovery()` para pegarle a `graph.facebook.com`
   con ese token en vez de `graph.instagram.com`.
3. No debería requerir la verificación de negocio de Meta (esa está rechazada, pero es un trámite
   específico de WhatsApp — ver [[project_whatsapp_setup]]) ni App Review completo, mientras la cuenta de
   Facebook de Lucía quede como tester/admin de la app.

### [BACKLOG] ✅ Auditado y reforzado (2026-07-20): `IMAGE_PROMPT_RULES` para otros estudios nombrados
El 2026-07-19 se corrigieron tres ambigüedades seguidas en `IMAGE_PROMPT_RULES` (`src/lib/ai.ts`),
encontradas una por regeneración real en la UI: (1) escenas de procedimiento sin ambientación de
consultorio, (2) figura médica que podía leerse como hombre en vez de la Dra. Chahin (mujer), (3) el
transductor de un ecocardiograma apoyado sobre el abdomen (pose de ecografía obstétrica) en vez del
pecho/tórax. La regla de posicionamiento anatómico (3) solo se especificó en detalle para
"ecocardiograma" — el texto generalizaba "la misma lógica aplica a cualquier otro estudio nombrado",
pero eso dependía de que el modelo infiera bien por analogía.

**Auditoría en vivo (script temporal contra la API real de Gemini, descartado después, sin tocar
Supabase)** probando 3 llamadas reales por estudio para "Estudios cardiologicos" con la regla vieja:
- **Ergometría/prueba de esfuerzo**: sin ambigüedad — el modelo ya devuelve consistentemente una
  cinta y un monitor de ECG en uso (prior cultural fuerte, como con "guardia" antes del fix de
  consultorio). No necesitaba regla nueva.
- **Electrocardiograma**: sin error anatómico — el modelo elige mostrar la tira impresa del ECG
  siendo analizada en vez del procedimiento en sí (variación de estilo válida, no una confusión de
  cuerpo/pantalla como la del eco). Tampoco necesitaba regla nueva.
- **Holter**: ambigüedad real encontrada — el modelo mostraba el dispositivo solo, apoyado en un
  escritorio o sostenido en la mano ("product shot"), sin transmitir que es un monitor que el
  paciente lleva puesto 24-48hs. 1/1 corridas con la regla vieja.
- **MAPA (monitoreo ambulatorio de presión)**: intermitente — a veces mostraba el manguito puesto en
  el brazo del paciente (correcto), otras veces solo el dispositivo exhibido aparte, mismo patrón de
  la intermitencia original del eco antes de su fix.

**Fix**: se agregaron instrucciones anatómicas explícitas para HOLTER (electrodos adhesivos en el
pecho, cables a un grabador en correa/cinturón — nunca el dispositivo solo) y MAPA (manguito puesto
sobre el brazo, conectado a un grabador portátil — nunca el manguito solo), mismo patrón "TIENE
que... NUNCA..." que ya usaba la regla de ecocardiograma. **Verificado en vivo de nuevo** con la
regla reforzada: Holter pasó de 1/1 mal a 5/6 corridas correctas (electrodos en el pecho del
paciente, grabador en cinturón/correa) en dos tandas de prueba; MAPA se mantuvo alto, 5/6 correcto
(manguito puesto en el brazo). No se llegó a 6/6 determinístico — coherente con la naturaleza
estocástica del modelo, mismo nivel de rigor que la verificación original del fix de eco. Se
mantiene la generalización para cualquier otro estudio no cubierto explícitamente, ahora con una
frase adicional aclarando que un "product shot" del equipo solo no alcanza si el estudio real
requiere mostrarlo puesto sobre una persona. `npm test`/lint/build verificados sin regresión. Ver
[[feedback_ui_completeness_lule]] en memoria para el patrón completo de los bugs de este bloque.

### [DECISIÓN] Google Business: descartado del front de Estudio de contenido (2026-07-07)
La API de Google (`accounts.list`) nunca devolvió `account_id` para la sede conectada, así que
publicar posts ahí siempre iba a requerir el paso manual de copiar/pegar (la cuenta probablemente es
Manager, no Owner directo del perfil). El usuario decidió no mantener trabajo manual recurrente por
un canal de bajo impacto: se sacó del front (checkbox de canal, textarea, botones de publicación,
banner manual), pero el backend (`google-business.ts`, `content-publish.ts`,
`resolveChannelsToPublish`) sigue siendo genérico multi-canal para reactivarlo más adelante sin
reconstruir nada. El pendiente de aumento de cuota en Etapa 4 sigue vigente para Perfil/Reseñas (no
relacionado a este tema).

### [FEATURE] ✅ Resuelto (2026-07-07): Alerta proactiva si falla el cron de auto-publicación
Se evaluó automatizar esto con n8n, pero no había ninguna necesidad real que justificara sumar una
herramienta nueva (self-hosteada o paga) — los flujos repetitivos del proyecto ya corren directo en
crons de Vercel. Se resolvió más simple: `/api/cron/publish-content` y `/api/cron/weekly-report` ahora
mandan un email de alerta (vía Resend, `src/lib/alert-email.ts`) ante una excepción no controlada o un
error real (no ante estados esperados como `skipped_*`). Por WhatsApp seguiría requiriendo un template
aprobado por Meta, así que se optó por email. Fail-open a propósito: sin `RESEND_API_KEY`/`ALERT_EMAIL_TO`
configuradas, no manda nada y no bloquea el cron — ver `CLAUDE.md` → "Alertas de cron por email".

### [SECURITY] ✅ Resuelto (2026-07-07): OAuth de Google Business/Instagram sin auth + webhook de WhatsApp sin firma
Auditoría de seguridad completa encontró y corrigió 3 vulnerabilidades reales: `/api/google-business/auth`,
`/api/instagram-business/auth` y sus `/callback` no requerían sesión (cualquiera con la URL podía
secuestrar la conexión con su propia cuenta de Google/Instagram); los `/status` de ambas integraciones
filtraban datos sin auth; y el webhook de WhatsApp no verificaba `X-Hub-Signature-256`, permitiendo
mensajes "entrantes" forjados. Los tres quedaron corregidos y mergeados — `WHATSAPP_APP_SECRET` ya está
cargado en Vercel y confirmado activo con una prueba real. Detalle completo en memory
`project_security_audit_2026-07-07`.

### [SECURITY] ✅ Resuelto (2026-07-07): Alta de usuarios (signup) cerrada en Supabase Auth
Las políticas RLS de `leads`, `messages`, `app_config`, etc. dan acceso total de lectura/escritura a
"cualquier usuario autenticado" (`to authenticated using (true)`) — es un patrón razonable para un
equipo chico, pero solo es seguro si el registro de cuentas nuevas por email está deshabilitado. Se
verificó en el dashboard de Supabase (Authentication → Sign In / Providers) que "Allow new users to
sign up" estaba **prendido** (cualquiera podía registrarse y quedar con acceso total) — se apagó y
guardó. Solo quedan los 3 usuarios ya existentes (dra. Lucía, lchahin2015, Seba); para sumar gente
nueva al equipo hay que crearla a mano desde Authentication → Users → Add user.

### [TECH] ✅ Resuelto (2026-07-20): vuln moderada transitiva en `postcss` (vía `next`)
XSS en el stringify de CSS de `postcss` (`GHSA-qx2v-qp2m-jg93`), dependencia interna de `next`. El fix
automático (`npm audit fix --force`) seguía bajando Next a una versión canary vieja — no conviene, y
la última versión estable de Next (16.2.10, verificado contra el registry) todavía bundlea
`postcss@8.4.31` (vulnerable, la reparación real está en `>=8.5.10`) — no era cuestión de esperar un
patch más, ese patch no estaba en el roadmap visible de Next. En vez de eso se agregó
`"overrides": { "postcss": "^8.5.15" }` en `package.json`: fuerza la resolución de **cualquier**
`postcss` anidado (incluido `node_modules/next/node_modules/postcss`) a una versión ya parcheada, sin
tocar la versión de Next ni arriesgar una regresión de canary. postcss 8.x mantiene compatibilidad de
API entre parches menores, así que este forzado no debería romper el pipeline de CSS de Next/
Tailwind — confirmado con `npm run build` real (todas las rutas, estáticas y dinámicas, compilaron
igual que antes) más `npm audit` en 0 vulnerabilidades (antes: 2 moderadas). De paso se actualizó
`next` de `16.2.9` a `16.2.10` (último patch estable, sin relación con esta vuln puntual). `npm test`
(884/884) y lint sin errores.

### [TECH] ✅ Resuelto (2026-07-08): ciclo de vida de piezas en Estudio de contenido (archivar/restaurar, edición de publicadas, UX de placa/alt text)
Auditoría de "borradores" encontró y corrigió 3 problemas reales (PR #12, #13, #14):
1. "Restaurar pieza" desde archivo siempre volvía a `"draft"`, sin importar si estaba `"approved"` o
   `"published"` antes de archivarse — una pieza ya publicada en Instagram podía quedar como si nunca
   se hubiera posteado. Se agregó `archived_from_status` en `ContentItem` para restaurar al estado real.
2. Editar el contenido de una pieza `"published"` y guardar la revierte a `"draft"` en silencio
   (comportamiento intencional desde antes, para no dejar contenido sin revisar marcado como
   publicado) — se agregó la misma confirmación que ya tenía "Deshacer publicación".
3. Dos botones "Regenerar" con alcance muy distinto (alt text vs. concepto de la imagen) generaban
   confusión real de uso (clicks repetidos al equivocado). Tras dos iteraciones de UI que no
   alcanzaron, se resolvió eliminando el campo de alt text de la vista por completo — se sigue
   generando solo, en segundo plano, sin intervención manual. Detalle en memory
   `project_content_draft_lifecycle_fixes` y `feedback_ui_completeness_lule` (caso 7).

### [TECH] ✅ Resuelto (2026-07-20): la confirmación de "esto va a volver a Borrador" solo cubría piezas `published`, no `approved`
El fix del 2026-07-08 (arriba) agregó una confirmación al guardar cambios sobre una pieza
`"published"` ("esto la va a devolver a Borrador"), pero `saveChanges()` en
`src/app/(app)/contenido/instagram/page.tsx` solo chequeaba `item.status === "published"` — si la
pieza estaba `"approved"` (no publicada todavía), guardar cualquier edición (incluido el selector de
Formato agregado 2026-07-08) la revertía a Borrador **sin ningún aviso**. Pasó en la sesión original:
el usuario cambió el Formato de una pieza aprobada, guardó, y se confundió al no ver más el badge de
"próxima en publicarse" — no relacionó el cambio con que la pieza había vuelto a Borrador. Corregido
agregando un segundo `window.confirm` en `saveChanges()` para `item.status === "approved"`
(mensaje distinto al de `"published"`: aclara que sale de la cola de publicación automática hasta
volver a aprobarla), sin tocar el `resetApproval` server-side de `/api/content/items` que ya hacía
el revert correcto — el gap era solo la falta de aviso en el cliente.

### [TECH] Cron de `publish-content` no tiene horario garantizado (plan Hobby de Vercel)
2026-07-10: el cron configurado para las 08:45 ART terminó ejecutándose a las 09:45 ART. Confirmado
con la doc oficial de Vercel: el plan Hobby no garantiza precisión de minuto en cron jobs
("per-hour, ±59 min"), solo el plan Pro ejecuta al minuto exacto. Se adelantó el horario a las
**07:30 ART (10:30 UTC)** en `vercel.json` como paliativo (apuesta a que el margen de imprecisión
típico caiga cerca de las 8:30 reales), pero **no hay garantía real** — si sigue disparando fuera
de rango, las dos alternativas reales son: (1) mover el disparo a un cron externo gratuito (ej.
cron-job.org o un GitHub Action programado) que pegue a `/api/cron/publish-content` con el
`CRON_SECRET` existente, sin depender del scheduler de Vercel; o (2) upgradear a Vercel Pro
(decisión de billing, no tomarla sin confirmación explícita del usuario). Ver memoria
`project_vercel_cron_limit`.

### [ANÁLISIS] Plan de mejoras de Instagram (benchmark ChatGPT, 2026-07-11) — qué suma y qué no
Seba compartió un documento externo (benchmark de perfiles médicos + propuesta de arquitectura para el
Estudio de contenido: objetivos REACH/EDUCATION/TRUST/CONVERSION, pilares clínicos, reel silencioso con
shot list, variantes A/B de hook, workflow editorial DRAFT_AI→REVIEW_REQUIRED→CHANGES_REQUESTED→
APPROVED→SCHEDULED→PUBLISHED→ARCHIVED, plantillas visuales, banco de clips, benchmark de competidores).
Se comparó contra el código real antes de sumar nada. Original en
`Plan_mejoras_Lule_Growth_OS_Instagram_Dra_Lucia_Chahin_COMPLETO.md` (raíz del repo).

**Ya cubierto hoy, no duplicar**: formatos post/reel/carrusel/historia + selector; 4 estados
(draft/approved/published/archived) con auto-revert a borrador al editar una pieza aprobada/publicada;
generación IA con guardrails médicos propios en `ai.ts` (no depende de `medical-safety.ts`, que es solo
del bot); research de fuentes clínicas reales vía Europe PMC (`/api/content/sources`, el doc externo ni
lo contemplaba); 3 paletas visuales; link de tracking `utm_content` por pieza con visitas/clicks
agregados; bloqueo duro (UI + backend, `PUBLISHABLE_FORMATS` en `instagram-business.ts`) de
auto-publish/publish-now para reel y carrusel — coincide con lo que pide el doc *(nota: el carrusel se
desbloqueó más tarde el mismo día, ver Etapa 5/7 más arriba; el reel sigue bloqueado, requiere video)*; cola con
`days_of_week`/`items_per_run`/`queue_rank`/`starts_at`; patrón de variantes A/B ya construido (aplicado
hoy al hero de landings, reutilizable en concepto).

**Implementado (2026-07-11), ✅ los 4 items de bajo esfuerzo que sí eran viables**:
1. ✅ Objetivo real seleccionable — `ContentObjective` (`alcance`/`educacion`/`confianza`/`conversion`) en
   `src/types/index.ts`, selector en el brief del Estudio de contenido, alimenta el hook/CTA vía
   `OBJECTIVE_GUIDANCE` en `ai.ts` (tanto modo IA como modo manual). `goal` ya no es un string fijo: se
   calcula con `CONTENT_OBJECTIVE_GOALS[objective]`. Piezas viejas sin `objective` se tratan como
   `conversion` al mostrarse.
2. ✅ Pilares clínicos — se expandió `CATEGORIES` en `page.tsx` sumando los pilares del benchmark que
   faltaban (Estudios cardiologicos, Sintomas de alarma, Mitos y errores frecuentes, Cardiologia
   femenina, Corazon y metabolismo, Habitos y adherencia), sin agregar un campo nuevo — se decidió no
   duplicar taxonomía, `category` ya cumplía ese rol y el usuario puede seguir escribiendo una categoría
   libre.
3. ✅ Guion estructurado para reel — nuevo campo `scenes` (`ContentScene[]`: `from`/`to`/`onScreenText`/
   `shot`) + `reel_duration_seconds` en `ContentItem`. La IA lo genera solo para `format === "reel"`
   (`REEL_SCENE_RULES` en `ai.ts`, 3-5 escenas, 8-25 seg, todo legible sin audio). Editor propio en la UI
   (agregar/quitar escena, editar texto y dirección de toma) — no se generó ni gestiona video real, es
   texto guía para filmar a mano, coherente con que reels siguen sin auto-publish por API.
4. ✅ Detección de tema repetido — `findRecentDuplicateTopic()` en `content-pipeline.ts` (función pura,
   con tests), aviso no bloqueante en el brief si ya se generó algo con la misma categoría (o el mismo
   hook) en los últimos 30 días.

**Descartado por hallazgo nuevo al implementar (2026-07-11): funnel de atribución completo por pieza**
La idea original era unir `utm_content` de `landing_events` (ya agregado por pieza) con `utm_content` de
`leads` para mostrar leads/turnos confirmados por pieza, no solo visitas/clicks. Al revisar el código se
confirmó que **`leads.utm_content` nunca se completa hoy con un valor real**: el único escritor,
`/api/public/lead`, no tiene ningún llamador — el formulario público que lo invocaba se sacó de la
landing el 2026-07-04 (ver [DECISIÓN] "Revertido" en Etapa 2 de este mismo archivo), y el bot de
WhatsApp tampoco propaga `utm_content` a los leads que crea (su `referral`/`ctwa_clid` es para
clasificar pricing de Meta, no para atribuir a una pieza de contenido). Construir ese join hoy mostraría
"0 leads" en todas las piezas para siempre — no porque el contenido no convierta, sino porque no hay
ningún canal real conectando ambos datos. Es el mismo tipo de problema que ya llevó a revertir el
formulario de leads en su momento ("mostrar algo sin que funcione de verdad es peor que no tenerlo").
No se construyó nada — sigue mostrándose solo visitas/interacciones agregadas de landing (dato real, sin
cambios). Para retomarlo hace falta antes reactivar algún canal real que estampe `utm_content` en un
`lead` (reabrir el formulario público, o propagar el `utm_content` de la landing al bot de WhatsApp
cuando el visitante entra por el link de "Consultar por WhatsApp").

**Dudoso, requiere decisión explícita antes de construir**:
- Variantes A/B de hook/portada por pieza — duplica generación y carga de revisión; el proyecto ya
  decidió limitar a 3 piezas/semana para no sobrecargar la única revisora (Lucía). Sumar variantes va en
  contra de esa decisión salvo que se pida explícitamente.
- Migrar de "array JSON en `app_config.content_pipeline`" a tabla relacional — esfuerzo estructural
  grande (RLS, migraciones, reescritura de casi todo `content-pipeline.ts`); hoy está capado a 100 items
  y no hay señal de que se esté por llegar a ese límite. No iniciar sin necesidad real.
- Estados editoriales más granulares (REVIEW_REQUIRED/CHANGES_REQUESTED/SCHEDULED separados) — el modelo
  actual de 4 estados + revert automático a borrador ya cumple una función equivalente con menos
  fricción para un solo revisor. Más estados = más complejidad sin beneficio claro acá.

**Descartado, coherente con decisiones ya tomadas en el proyecto**:
- Banco de clips reutilizables (B-roll) — la app no genera, sube ni publica video en ningún punto (reels
  se bloquean de auto-publish igual que carruseles). Construir un banco de clips sin pipeline de video
  real es el mismo patrón de "feature con fallback manual permanente" que ya se cortó con Google Business
  (ver [DECISIÓN] arriba, 2026-07-07) — [[feedback_minimize_manual_work]].
- Plantillas visuales como entidad separada del prompt de IA — hoy el rol de "plantilla" ya lo cumplen
  las reglas de `IMAGE_PROMPT_RULES` + Gemini generando la imagen final directo; separar en una capa de
  composición reutilizable es una reescritura grande para una ganancia marginal.
- Benchmark de competidores vía API de Instagram — confirmado no viable sin vincular una Facebook Page
  (mismo bloqueo que Business Discovery, ver standby arriba 2026-07-11) — cambio estructural que el
  proyecto evita a propósito. La alternativa manual (carga CSV/JSON) es técnicamente viable pero de bajo
  ROI para una consulta unipersonal; no construir salvo pedido explícito.

### [TECH] Falta página de Política de Privacidad + instrucciones de borrado de datos
Ninguna existe hoy (`grep -i "privacidad|privacy|terms"` sobre `src/app` no encontró nada). Son
requisito de Meta para cualquier App Review de "Instagram Login" (permisos `instagram_business_basic`,
`instagram_business_content_publish`). No es urgente mientras la única cuenta de Instagram conectada
(la de Lucía) siga agregada como tester en el Meta App — el modo desarrollo no expira para
testers/admins. Si en algún momento se decide sacar la app del modo desarrollo, hace falta: página
pública `/privacidad` con qué datos de leads se recolectan y cómo se usan, y una URL o texto de
instrucciones de borrado de datos. Ver memoria `project_meta_business_checklist`.

### [TECH] ✅ Resuelto (2026-07-20): los previews de Vercel seguían grabando visitas reales en `landing_events`
El PR #75 (ver CLAUDE.md → 2026-07-14) cortó el caso más común de contaminación de analytics
(`npm run dev` local, incluidos `npm run test:e2e:public` y sesiones de agentes verificando
visualmente) chequeando que `window.location.hostname` no sea `localhost`/`127.0.0.1`. Un preview
deploy de Vercel (dominio `*.vercel.app`, no localhost) no quedaba cubierto por ese guard — si
alguien navegaba un preview a mano para revisar un PR antes de mergear, esas visitas también se
grababan como reales en la misma base de producción (no hay proyecto de staging separado, ver
memoria `project_dashboard_data_integrity_2026-07-14`). Resuelto con la opción (a) que se había
dejado planteada: `POST /api/public/click` ahora corta temprano (devuelve `{ok: true}` sin insertar
ni consultar el rate limit) si `process.env.VERCEL_ENV` está definido y no es `"production"` —
`VERCEL_ENV` la inyecta Vercel automáticamente en cualquier deployment (`production`/`preview`/
`development`), no hace falta cargarla a mano ni es un secreto. Queda `undefined` fuera de Vercel
(`npm run dev`/`build`/`start` locales, runners de CI), así que no cambia nada del comportamiento
existente ahí — solo bloquea específicamente los previews reales de Vercel, que es el caso que
faltaba cubrir. Tests nuevos en `src/app/api/public/click/route.test.ts` (inserta en producción real
y cuando `VERCEL_ENV` no está definida; no inserta ni consulta rate limit en `preview`/
`development`).

### [TECH] ✅ Resuelto (2026-07-20): `click_instagram` no tenía ninguna card en el dashboard
El PR #104 agregó un link de confianza a Instagram cerca del inicio de las 7 landings públicas
(`src/app/landings/[slug]/instagram-trust-link.tsx`) y trackea el click como `click_instagram` en
`landing_events` (migración `20260716_landing_events_instagram_click.sql`, ya aplicada en
producción) — pero a propósito **no** se sumó al `IN`-list de "acciones de contacto/engaged" que usan
las funciones SQL de `dashboard_growth_metrics` (no es un paso hacia pedir turno, mezclarlo ahí
infla la tasa de conversión de forma engañosa). El dato ya se guardaba desde que se aplicó esa
migración, pero no se veía en ningún lado de `/dashboard`. Resuelto con el mismo patrón sugerido:
nueva función `landing_instagram_clicks(p_days)` (migración `20260720_landing_instagram_clicks.sql`,
conteo simple agregado en SQL, deliberadamente separada de `ACTION_META`/`contact_actions` por el
motivo de arriba) y una card chica "Clicks a Instagram desde la web" en `/dashboard`, junto a "Clicks
por sede", que solo muestra el total del período — sin mezclarlo con la tasa de conversión ni el
embudo de atribución existente. Migración aplicada en producción vía `npm run migrate`.

### [BUG] Fallback Gemini→Anthropic no se activó en la práctica (2026-07-19)
`generateText` (`src/lib/ai.ts`) tiene la lógica para reintentar con Anthropic cuando Gemini falla
(agregada el mismo día para el bug de JSON truncado). Verificado por logs (`ai_requests`, lectura
sola) que cuando Gemini falló hoy con `purpose=content_plan`, **no hubo ningún intento posterior a
Anthropic** — cero filas con `provider=anthropic` en todo el día, pese a `AI_PROVIDER=""` (modo auto)
y ambas API keys cargadas en `.env.local`. No se pudo confirmar la causa raíz con certeza en esta
sesión; la hipótesis más probable es que el proceso local de `npm run dev` ya estaba corriendo desde
antes de que `AI_PROVIDER` se editara a `""`, y una env var de servidor (no `NEXT_PUBLIC_`) no se
recargó en caliente — pero no se verificó reiniciando el servidor para confirmarlo. Si vuelve a pasar
después de reiniciar `npm run dev`, hay que revisar `getRequestedProvider()`/`getProviderOrder()` en
`src/lib/ai.ts` con logging temporal para ver qué valor real toma `AI_PROVIDER` en el momento del
fallo. Ver memoria `reference_gemini_config_gotchas` caso 6.
