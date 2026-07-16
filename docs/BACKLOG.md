# Backlog — Lule Growth OS
**Actualizado:** 2026-07-16 | **Basado en:** PRD Estrategia de Captación v2.1

---

## Bot de WhatsApp — gates para activar el hardening local (2026-07-16)

El hardening derivado de `Investigacion_y_plan_bot_WhatsApp_Dra_Lucia_Chahin_para_Claude.md` y de
los 180 casos del CSV está publicado en el PR #96 (`codex/whatsapp-fase0-safety`), con CI y Vercel
aprobados. Las nueve migraciones pasaron una ejecución transaccional real con rollback; la
aplicación persistente y el merge se coordinan en el cutover.

- [ ] **Revisión médica de Lucía:** aprobar detector y textos fijos de guardia, límites clínicos y
  derivación. La IA no redacta respuestas para pacientes; solo puede devolver categorías cerradas.
- [ ] **Revisión legal:** validar consentimiento por finalidad, texto de privacidad, proveedores y
  transferencia internacional, oposición/borrado y plazos de retención.
- [ ] **Decidir el primer mensaje pre-consentimiento:** hoy se descarta y se pide repetir. Reusarlo
  requiere base legal y almacenamiento temporal cifrado con plazo explícito, o consentimiento web
  previo al salto a WhatsApp.
- [ ] **Preparar producción:** definir `META_GRAPH_API_VERSION` y aplicar, primero en staging y en
  este orden exacto: `20260715_whatsapp_phase0a_safety.sql` (0A) →
  `20260716_whatsapp_phase0b_operations.sql` (0B) →
  `20260716_whatsapp_phase1_durable_transport.sql` (1) →
  `20260716_whatsapp_phase1b_outbound_ledger.sql` (1B) →
  `20260716_whatsapp_phase1c_queue_checkpoint.sql` (1C) →
  `20260716_whatsapp_phase1d_atomic_routing.sql` (1D) →
  `20260716_whatsapp_phase1e_erasure_suppression.sql` (1E) →
  `20260716_whatsapp_policy_shadow.sql` (policy) →
  `20260716_whatsapp_privacy_roles_retention.sql` (privacy). Después comprobar el worker interno
  con `CRON_SECRET` sin exponerlo.
- [x] **Compatibilidad SQL real:** las nueve migraciones se ejecutaron en orden contra el esquema
  real dentro de una única transacción y terminaron en rollback completo. El runner soporta
  `--dry-run`, `--atomic` y `--from` para que el cutover sea todo-o-nada.
- [ ] **Staging de concurrencia:** disponer de una base clonada, inspeccionar duplicados históricos
  de identidad/IDs de Meta que 1D reconcilia y probar interleavings reales entre cola, outbox,
  handoff y borrado. El dry-run real valida SQL y dependencias, no esas carreras temporales.
- [ ] **Programar recuperación frecuente:** después del deploy, guardar URL de producción y
  `CRON_SECRET` en Supabase Vault y crear un Supabase Cron/`pg_net` que llame cada minuto a
  `POST /api/internal/whatsapp-worker`. `after()` acelera el caso normal y el cron diario es sólo
  respaldo; sin este paso externo un retry aislado podría esperar hasta la corrida diaria.
- [ ] **Accesos:** asignar `app_metadata.role`, enrolar MFA, probar una cuenta por rol y recién luego
  activar los flags de autorización documentados en `docs/WHATSAPP_SECURITY_ROLES_RETENTION.md`.
- [ ] **Fuente operativa:** revisar y guardar CIMEL Lanús, Hospital Británico y Swiss Medical Lomas
  en Configuración. Sin evidencia de verificación el bot se niega deliberadamente a afirmar sede,
  día, dirección, servicio o canal de contacto.
- [ ] **Retención del registro de borrado:** pedir al asesor legal un plazo para
  `data_erasure_log`. El registro queda seudonimizado y sirve como evidencia, pero hoy no tiene una
  política automática de expiración definida.
- [ ] **Rollout:** mantener shadow/canary apagados hasta completar los gates anteriores; después
  medir primero en shadow, luego en una cohorte mínima con rollback inmediato.

Estado técnico local: contención Fase 0 y transporte durable Fase 1 completos; scaffolding offline
de Fases 2/3 listo; Fases 4/5 no activadas. El outbox evita reintentos automáticos ciegos, pero no
promete entrega externa exactamente una vez porque Meta no expone una clave de idempotencia.

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
- [ ] **Reaprobar el template `alerta_interna_derivacion` (actualizado 2026-07-16)**: el hardening
  lo redujo a un texto genérico con **una sola variable**, un ID opaco `CASO-…`; ya no envía nombre
  ni motivo por el aviso interno. La migración 0A lo deja en `borrador`, por lo que hay que enviar
  esta versión a aprobación en WhatsApp Manager y después configurar `ALERT_WHATSAPP_TO`. Hasta
  entonces, solo llega el email, que funciona de manera independiente.
- [x] **Acceso a las APIs de Google Business Profile** (proyecto `app-lule`) — **solicitud enviada
  el 2026-07-12**, caso de asistencia de Google **`2-7574000041506`**, tiempo de revisión
  informado por Google: 7-10 días hábiles (no es instantáneo, y con volumen chico existe la
  posibilidad de que la rechacen — ver [[reference_google_business_api_surface]] si se retoma).
  Mientras se resuelve, seguí editando perfil/publicaciones/reseñas desde el panel oficial de
  Google Business (Etapa 4).
- [ ] **Google Search Console**: configurar con el sitemap (ahora sí es alcanzable — un bug lo
  bloqueaba antes) y verificar que las 8 páginas públicas queden indexadas (Etapa 3).
- [ ] **Google Cloud (reseñas)**: revisar antes de octubre 2026 si se activa la cuenta completa o
  se deja pausar la prueba gratuita (Etapa 2).

### 🤔 Decisiones tuyas (o de Lucía)
- [ ] **Decidir cuándo activar el clasificador estructurado nuevo.** El schema jerárquico, la
  política determinista y las categorías sociales/administrativas ya están implementados offline.
  Primero deben medirse contra el dataset en shadow y revisarse las discrepancias; recién después
  corresponde un canary mínimo. La IA seguirá devolviendo enums validados, nunca texto para el
  paciente.
- [ ] Agregar a Lucía como administradora del Business Manager de Meta — falta decidir el rol
  (administrador completo vs. acceso acotado).
- [ ] Definir estrategia de reseñas de Google: cómo y cuándo pedirlas a pacientes actuales.
- [ ] Evaluar si crear una ficha de Google Business separada para Swiss Medical Lomas.
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
- [ ] Publicar los 3 posts fijados de Instagram (ya generados en Estudio de contenido).
- [ ] Crear las 7 historias destacadas de Instagram (Turnos · CIMEL · Hospital Británico · Swiss
  · Ecocardiograma · Cardiología · FAQ).
- [ ] Cargar las obras sociales reales por sede en Configuración (hoy están vacías).
- [ ] Cargar el link de Google Maps del Hospital Británico en Configuración.
- [ ] Confirmar que el `$0` (tarifa pública de Meta para Argentina) haya quedado guardado en
  `Configuración → Precios de WhatsApp`. Los templates de seguimiento existentes conservan su
  estado; `alerta_interna_derivacion` es la excepción y debe reaprobarse por separado en su nueva
  versión genérica de una variable.

### 🕐 Cuando tengas tiempo (no urgente)
- [ ] **Conectar la CLI de Vercel para que un agente pueda tocar env vars directamente (2026-07-15).**
  Hoy ningún agente puede cargar/editar variables de entorno de producción por su cuenta — ni la
  CLI de Vercel está instalada, ni el login (OAuth interactivo) se puede completar en una sesión no
  interactiva. Dos formas de resolverlo, ninguna aplicada todavía: (1) generar un token en
  vercel.com/account/tokens y pasárselo a un agente — da permisos amplios sobre tu cuenta de
  Vercel, no solo env vars, tenelo en cuenta; (2) correr `vercel login` una sola vez vos mismo en tu
  propia terminal en esta máquina — si la CLI queda logueada a nivel de tu usuario de Windows,
  sesiones futuras del agente en esta misma máquina podrían heredar esa sesión sin pedirte nada de
  nuevo. No es urgente — mientras tanto, cargar env vars a mano en el dashboard (2 minutos) sigue
  funcionando bien.
- [ ] **Cargar `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` en tu `.env.local` (2026-07-14, contraseña
  rotada de nuevo el 2026-07-15).** El usuario de prueba (`e2e-agent-test@lule-internal.local`,
  aislado de leads/pacientes reales) ya se usó dos veces para verificar visualmente con Playwright
  (dashboard el 14/07, Inbox/leads con la priorización nueva el 15/07). La contraseña anterior no
  se había guardado, así que se rotó de nuevo — se mostró una única vez en el chat de la sesión del
  2026-07-15. Falta que vos cargues esas dos variables para que quede permanente entre sesiones
  (mías y de Codex) y para que `npm run test:e2e` corra los tests `authenticated` en vez de
  saltarlos. Si no la guardaste esta vez tampoco, hay que rotarla de nuevo (ver
  [[reference_e2e_test_account]] en memoria, o pedirle a un agente que la regenere).
- [ ] **Correr el resto del smoke E2E autenticado al menos una vez** (`e2e/authenticated/*.spec.ts`
  — dashboard, crear/editar/buscar un lead, abrir una conversación del inbox), no solo el login. Con
  las credenciales ya cargadas: `npm run test:e2e`. Cierra QA-02 del todo (ver más abajo).
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

- [x] **QA-02 — Smoke E2E móvil y desktop.** ⏳ Parcial (2026-07-12, actualizado 2026-07-14) — falta correr los `.spec.ts` autenticados con un usuario real (el login en sí ya se probó)
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
  - **Pendiente real**: correr `npm run test:e2e` completo con las credenciales cargadas en
    `.env.local` (no dar QA-02 por completamente cerrado hasta entonces), y configurar que corran en
    CI/GitHub Actions con esas credenciales como secret.
  - **Aceptación parcial cumplida**: el smoke público corre y pasa contra un build de producción,
    con evidencia (reporte HTML de Playwright). El login autenticado ya se verificó corriendo de
    verdad; falta correr los `.spec.ts` que dependen de esa sesión para la aceptación completa.

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

- [ ] **WEB-01 — QA visual y simplificación de la landing.**
  - Revisar móvil/desktop con navegador real y prueba rápida con usuarios.
  - Medir si la repetición de “Dónde atiende” y “Pedir turno” ayuda o alarga el recorrido; consolidar
    sin perder instrucciones por sede si los datos muestran fricción.
  - **Aceptación:** no hay regresiones visuales y el CTA principal queda accesible en teclado y móvil.

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
- [x] Sección "Obras sociales y formas de atención" — muestra coberturas cargadas por sede en Configuración, o mensaje honesto invitando a consultar si todavía no hay datos cargados *(pendiente: cargar `obras_sociales` reales por sede en Configuración — hoy están vacías)*
- [x] Sección "Opiniones de pacientes" — reseñas reales de Google vía Places API (New) desde el 2026-07-04 (`GOOGLE_PLACES_API_KEY` + `GOOGLE_PLACE_ID`, ver CLAUDE.md). Cae al placeholder honesto si la API no está disponible.
- [x] JSON-LD: `Physician` + `FAQPage` en todas las landings, `BreadcrumbList` en landings SEO, `identifier` (matrícula) cuando esté cargada *(pendiente: `MedicalClinic` por sede)*
- [x] Eventos de analítica ampliados (2026-07-06) — `landing_events` ahora también registra `page_view` (una vez por carga de landing) y clicks separados por acción (`click_booking`/`click_call`/`click_whatsapp`/`click_maps`) con `location_key` por sede, además de los `cta_*` históricos que se mantienen para no romper las métricas globales existentes. El link "Cómo llegar" no trackeaba nada antes; ahora sí.

### Revertido (2026-07-04)
- [x] ~~Formulario "No pude pedir turno" en las landings~~ — se sacó de la web pública. Creaba un lead `seguimiento_pendiente` prometiendo "te ayudamos", pero **hoy nadie revisa el CRM/Inbox** para mandar ese seguimiento manual (`/api/followup` requiere que un usuario logueado lo dispare a mano). Mostrar el formulario sin nadie contestando es peor que no tenerlo. Quedan solo los canales que responden solos: llamar y el bot de WhatsApp. El backend (`/api/public/lead`, con el campo `insurance` ya soportado) queda intacto sin uso — reactivar cuando haya alguien asignado a hacer el seguimiento manual, o cuando se automatice la respuesta por WhatsApp (Etapa 7).

### Acciones externas (las hace Lucía)
- [x] Configurar `/dra-lucia-chahin` como link de la bio en Instagram — hecho vía dominio propio `draluciachahin.ar`, ver Etapa 5
- [ ] Configurar `/dra-lucia-chahin` como sitio web en Google Business Profile *(acción de Lucía)*

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
- [ ] Configurar Google Search Console con el sitemap — **antes de esto (2026-07-11, SEO-01) el
      sitemap no era alcanzable en absoluto**: `/sitemap.xml` y `/robots.txt` quedaban atrapados
      por el auth gate de `proxy.ts` y devolvían un redirect a `/login`, así que si esto se había
      intentado antes probablemente falló. Ya corregido, ahora ambos son públicos.
- [ ] Verificar indexación de las 8 páginas públicas en Search Console (7 + `/cardiologa-caba`
      nueva)

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
- [ ] Evaluar si crear ficha separada para Swiss Medical Lomas (dirección ya confirmada: Oliden 141, Lomas de Zamora)
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
- [ ] Publicar los 3 posts fijados (cómo pedir turno / servicios / dónde atiende)
- [ ] Crear las 7 historias destacadas: Turnos · CIMEL · Hospital Británico · Swiss · Ecocardiograma · Cardiología · FAQ
- [ ] Establecer ritmo de publicación mensual: 2-3 conversión + 4-6 educativo + 2-3 local

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
- [ ] **Insights por post de Instagram** (reach, likes, comments) — evaluado el 2026-07-13, no
      implementado: `publishContainer()` en `src/lib/instagram-business.ts` devuelve el `mediaId`
      de Meta pero **no se persiste en ninguna tabla** hoy (se pierde apenas termina el request de
      publicar). Sin guardar ese ID no se puede pedir `/insights` de un post después de publicado.
      Requiere primero agregar una tabla/columna que guarde `media_id` + `item_id` al publicar
      (cambio de esquema), después sí una función de insights análoga a `getFollowerCount()`. El
      scope de OAuth (`instagram_business_manage_insights`) ya está cargado, no hace falta
      reconectar nada para esto.
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
- [ ] Configurar `WHATSAPP_VERIFY_TOKEN` en `.env.local` + webhook de prueba separado (vía ngrok) para poder testear localmente cambios en la lógica de recepción de mensajes (`src/lib/whatsapp-bot.ts`) sin tocar el webhook de producción. Sin esto, cualquier cambio en cómo el bot procesa mensajes entrantes solo se puede probar directo en producción. No es urgente mientras no se toque esa lógica.
- [x] Instagram Graph API: publicación directa desde la app del contenido aprobado (2026-07-06/07) —
      manual ("Publicar ahora" y botones por canal en el editor) y automática (Vercel Cron diario,
      dos cronogramas independientes: posts de feed y historias, cada uno con su propia frecuencia
      "veces por semana"). Ver `src/lib/content-publish.ts`, `src/app/api/cron/publish-content/`,
      `docs/CONTENT_STUDIO.md` → "Publicacion automatica".
- [ ] Automatización de flujos de seguimiento con n8n
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

### [TECH] `npm audit`: vuln moderada transitiva en `postcss` (vía `next`)
XSS en el stringify de CSS de `postcss` (`GHSA-qx2v-qp2m-jg93`), dependencia interna de `next`. El fix
automático (`npm audit fix --force`) bajaría Next a una versión canary vieja — no conviene. Bajo riesgo
real (no hay contenido de usuario que fluya a valores CSS en esta app). Esperar a que Next libere un
patch que actualice su propia dependencia de `postcss`.

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

### [TECH] La confirmación de "esto va a volver a Borrador" solo cubre piezas `published`, no `approved`
El fix del 2026-07-08 (arriba) agregó una confirmación al guardar cambios sobre una pieza
`"published"` ("esto la va a devolver a Borrador"), pero `saveChanges()` en
`src/app/(app)/contenido/instagram/page.tsx` solo chequea `item.status === "published"` — si la
pieza está `"approved"` (no publicada todavía), guardar cualquier edición (incluido el nuevo
selector de Formato agregado 2026-07-08) la revierte a Borrador **sin ningún aviso**. Pasó en esta
sesión: el usuario cambió el Formato de una pieza aprobada, guardó, y se confundió al no ver más el
badge de "próxima en publicarse" — no relacionó el cambio con que la pieza había vuelto a Borrador.
Sugerencia: extender el mismo `window.confirm` (o un aviso menos invasivo) para `"approved"` también,
no solo `"published"`.

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

### [TECH] Los previews de Vercel siguen grabando visitas reales en `landing_events` (2026-07-14)
El PR #75 (ver CLAUDE.md → 2026-07-14) cortó el caso más común de contaminación de analytics
(`npm run dev` local, incluidos `npm run test:e2e:public` y sesiones de agentes verificando
visualmente) chequeando que `window.location.hostname` no sea `localhost`/`127.0.0.1`. Un preview
deploy de Vercel (dominio `*.vercel.app`, no localhost) **no queda cubierto por ese guard** — si
alguien navega un preview a mano para revisar un PR antes de mergear, esas visitas también se graban
como reales en la misma base de producción (no hay proyecto de staging separado, ver memoria
`project_dashboard_data_integrity_2026-07-14`). No se resolvió en el mismo PR porque requiere decidir
entre: (a) chequear `process.env.VERCEL_ENV !== "production"` server-side antes de insertar el
evento (más robusto, cubre cualquier dominio no-producción, pero agrega una env var más a la
superficie del endpoint público), o (b) mantener un allowlist de dominio (`draluciachahin.ar`) en el
cliente. Bajo impacto real hoy (los previews se navegan poco, casi todo el volumen sospechoso venía
de local), no urgente.
