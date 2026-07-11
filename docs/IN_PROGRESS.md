# Arquitectura de costos de WhatsApp Business Platform + reducción de mensajes

## Objetivo

Preparar el bot de WhatsApp (hoy en producción solo para testers, verificación de negocio de Meta
en revisión) para el esquema de costos real de Meta: pricing por mensaje entregado desde 1/7/2025 y
el fin de la gratuidad de mensajes service/utility dentro de ventana a partir del 1/10/2026. Reducir
la cantidad de mensajes por conversación sin perder conversión, y agregar trazabilidad de costo,
guardrails médicos, consentimiento y derivación a humano.

## Hallazgo clave antes de empezar

El bot real (`whatsapp-bot.ts`, máquina de estados sin IA) y el "inbox" simulado (`ai.ts` +
tabla `messages`) eran dos sistemas desconectados — el inbox nunca se conecta al webhook real
(confirmado: nadie lo usa hoy, `docs/BACKLOG.md` Etapa 2). El bot no trackeaba ventana de 24h, no
usaba templates, no registraba costo ni mensajes en ninguna tabla. No había ningún framework de
testing en el proyecto.

## Cambios

- [x] Jest (nuevo): `jest.config.js` con `next/jest`, `npm test`, tests junto a cada lib de `src/lib/`.
- [x] Migraciones: `whatsapp_pricing_rules`, `whatsapp_cost_events`, `templates` (9 seed), `consent_records`,
      `handoff_events`; extendidas `leads` (protocolo, edad, notas, status `elegible_protocolo`),
      `whatsapp_sessions` (ventana, entry point, contador de mensajes), `messages` (ahora sí las
      escribe el bot real: dirección, categoría, template, costo).
- [x] `whatsapp-pricing.ts`: motor de precios por fecha de vigencia (sin montos hardcodeados — los
      reales no están públicos, hay que completarlos a mano, ver `CLAUDE.md`).
- [x] `whatsapp-window.ts`: ventana de 24h + Free Entry Point (72h, detecta `referral`/Click-to-WhatsApp
      del webhook).
- [x] `medical-safety.ts`: guardrail de emergencia extraído y ampliado con los síntomas pedidos.
- [x] `whatsapp-cost-tracking.ts`, `whatsapp-consent.ts`, `whatsapp-handoff.ts`, `whatsapp-templates.ts`,
      `whatsapp-intents.ts` (9 intents cerrados, reglas primero, IA de respaldo opcional),
      `whatsapp-settings.ts` (modo ahorro, flag de octubre 2026, umbrales de conversación).
- [x] `whatsapp.ts`: agrega `sendTemplate`, logging de costo, y bloquea texto libre fuera de ventana
      (`WindowClosedError`) — antes no existía ningún gate.
- [x] `whatsapp-bot.ts` reescrito: primer mensaje combina consentimiento + las 5 preguntas en bloque
      (motivo/cobertura/edad/sede/síntomas), solo pregunta puntualmente lo que falta, ruta a protocolo,
      límite de mensajes por conversación (aviso a los 8, deriva a los 12 salvo alto valor).
- [x] Configuración: selector de proveedor de IA del bot (solo Gemini/Claude reales; OpenAI/otro LLM/
      Meta Business Agent seleccionables pero no implementados a propósito), modo ahorro, editor de
      precios, viewer de templates.
- [x] Dashboard `/costos`: costo diario/semanal/mensual, costo por paciente/lead/turno/protocolo,
      ranking de flows, alertas de conversación larga y de gasto proyectado.
- [x] `npm run lint`, `npx tsc --noEmit` y `npm run build` finalizaron sin errores. `npm test`: 57 tests.

## Pendiente (acciones externas — no las puede hacer el agente)

- Completar los montos reales de `whatsapp_pricing_rules` desde WhatsApp Manager → Facturación
  (no son públicos ni estáticos, dependen de la cuenta/volumen — ver `CLAUDE.md`).
- Enviar los 9 templates a aprobación real en WhatsApp Manager y marcarlos "Aprobado" en Configuración.
- Correr `npm run migrate` contra Supabase de producción (requiere `.env.local` con `SUPABASE_DB_PASSWORD`).

---

# Revisión integral de gestión + diagnóstico "no puedo conectarme con Google Maps"

## Objetivo

Auditar las páginas de gestión ((app)) y resolver por qué la conexión con Google
Business (mostrada como "Google Local" / percibida por la doctora como "Google Maps")
deja de funcionar.

## Diagnóstico

- El flujo OAuth y el `redirect_uri` (`https://draluciachahin.ar/api/google-business/callback`)
  están bien formados — confirmado pegándole directo al endpoint de producción.
- `app_config` en Supabase tenía un `google_refresh_token` guardado el 2026-06-20 que dejó
  de poder refrescarse: `/api/google-business/status` devuelve `connected:false` en producción.
- Causa raíz: el proyecto de Google Cloud sigue en modo **Prueba** (no verificado) para el
  scope `business.manage`. Google expira los refresh tokens emitidos por apps no verificadas
  a los 7 días — coincide con la fecha del último refresh exitoso. Esto es una limitación de
  Google, no un bug de la app: hay que reconectar periódicamente hasta que se verifique/publique
  el OAuth consent screen en Google Cloud Console (o se agregue a la doctora como test user si
  no lo está, para que al menos el reconectar funcione).
- Hallazgo de seguridad no relacionado: `/api/config` devolvía **toda** la tabla `app_config`
  (incluidos `google_access_token`/`google_refresh_token`) al navegador de la doctora cada vez
  que abría Configuración, y ni el GET ni el POST verificaban sesión (dependían solo de RLS).
  RLS sí bloqueaba a usuarios anónimos (verificado en producción), pero igual se corrigió como
  defensa en profundidad.

## Cambios

- [x] `/api/config`: allowlist de claves (`doctor`, `locations`) + chequeo de sesión en GET/POST.
- [x] `/api/google-business/status`: agrega `expired: true` cuando hubo conexión pero el
      refresh token ya no es válido (distinto de "nunca conectado").
- [x] `google-local`: `ConnectView` explica la reconexión de ~7 días en modo Prueba en vez de
      mostrar el mismo mensaje genérico de "conectar por primera vez".
- [x] Sanitiza el parámetro de búsqueda de leads antes de interpolarlo en `.or()` de PostgREST
      (`src/lib/utils.ts#sanitizePostgrestValue`), en `/api/leads` y `/leads` (server component).
- [x] Inbox: agrega polling (leads cada 20s, mensajes del lead abierto cada 8s) para que
      conversaciones entrantes aparezcan sin recargar.
- [x] `npm run lint` y `npm run build` finalizaron correctamente.

## Pendiente (requiere acceso a Google Cloud Console — no lo puede hacer el agente)

- Publicar/verificar el OAuth consent screen para el scope `business.manage`, o como mínimo
  confirmar que la cuenta de Google que conecta la doctora está en la lista de "Test users".
  Mientras siga en modo Prueba, va a pedir reconexión cada ~7 días (ahora con un mensaje claro
  en pantalla explicando por qué).
- Vercel tiene una env var `GOOGLE_REDIRECT_URI` (Production, creada hace 22 días) que no usa
  ningún archivo del código — el código usa `GOOGLE_OAUTH_BASE_URL`. No se tocó porque
  modificar env vars de producción no estaba pedido, pero conviene limpiarla o confirmar que
  no la usa nada externo.

---

# En progreso - Google Business Location ID

## Objetivo

Permitir conectar la ficha de Google Business cuando Google no expone el Account ID y la API de descubrimiento esta con cuota 0.

## Brechas encontradas

- Google OAuth queda conectado, pero `accounts.list` no puede listar negocios si el proyecto tiene cuota 0.
- La interfaz nueva de Google Business no muestra siempre el Account ID.
- La app exigia Account ID aunque la Business Information API puede editar el perfil con `locations/{locationId}`.

## Plan

- [x] Aceptar guardado manual con solo Location ID.
- [x] Mantener Account ID como opcional para cuentas donde Google si lo devuelve.
- [x] Explicar que publicaciones y resenas siguen requiriendo Account ID o acceso API aprobado.
- [x] Dejar Publicaciones en modo manual cuando falta Account ID.
- [x] Verificar, commitear y pushear.

## Resultado

- La seleccion manual de Google Business acepta solo Location ID.
- El Account ID queda opcional para cuentas donde Google lo devuelve automaticamente.
- Publicaciones permite generar y copiar texto manualmente cuando falta Account ID.
- Resenas muestra un mensaje especifico cuando falta Account ID.
- `npm run lint` y `npm run build` finalizaron correctamente.

---

# En progreso - Skills y documentacion PRD/backlog

## Objetivo

Instalar skills utiles para el proyecto y actualizar la documentacion para dejar explicita la necesidad de una pagina web publica de la Dra. Lucia Chahin como activo central de captacion.

## Plan

- [x] Revisar instrucciones de `skill-installer`.
- [x] Instalar skills relevantes para QA, deploy, seguridad y flujo Git.
- [x] Actualizar PRD con la pagina web publica/institucional de Lucia.
- [x] Actualizar backlog de pendientes.
- [x] Verificar cambios, commitear y pushear.

## Skills instaladas

- `playwright`
- `screenshot`
- `vercel-deploy`
- `security-best-practices`
- `security-threat-model`
- `yeet`

Nota: reiniciar Codex para que las nuevas skills queden disponibles en una proxima sesion.

## Resultado

- PRD actualizado a version 2.1 con el sitio web publico de Lucia como activo central de captacion.
- Backlog actualizado con pendientes de web publica, rutas raiz, seguimiento automatico, confirmacion de turno, metricas y schema.
- `npm run lint` finalizo correctamente.
- `npm run build` finalizo correctamente; Next aviso que `middleware` esta deprecado a favor de `proxy`.

---

# En progreso - Web publica y slugs SEO raiz

## Objetivo

Publicar el sitio publico de la Dra. Lucia Chahin en `/dra-lucia-chahin`, exponer las landings SEO en rutas raiz, completar contenido institucional y activar seguimiento automatico desde el formulario publico.

## Plan

- [x] Revisar backlog, PRD y landing existente.
- [x] Publicar slugs raiz reutilizando la landing publica.
- [x] Completar contenido institucional de `/dra-lucia-chahin`.
- [x] Crear leads publicos como `seguimiento_pendiente` con `followup_due_at` +24h.
- [x] Actualizar docs/backlog/schema.
- [x] Correr lint/build, commitear y pushear.

## Resultado

- `/dra-lucia-chahin` y los seis slugs SEO locales quedaron publicados en raiz.
- La pagina principal ahora incluye quien es Lucia, servicios, sedes, dias, instrucciones, avisos y formulario.
- El formulario publico crea leads en `seguimiento_pendiente` con `followup_due_at` a 24 horas.
- `docs/schema.sql` quedo alineado con tracking UTM/clicks y tablas IA.
- `npm run lint` y `npm run build` finalizaron correctamente.
- Verificacion Playwright: `/dra-lucia-chahin` y `/cardiologa-lanus` cargaron con HTTP 200, contenido visible y sin errores de consola.

---

# En progreso - Google OAuth bloqueado por politica

## Objetivo

Resolver el bloqueo `Error 400: invalid_request` al conectar Google Business Profile, alineando el flujo OAuth con validaciones modernas de Google.

## Plan

- [x] Revisar rutas OAuth de Google Business.
- [x] Agregar `state` y PKCE al inicio de autorizacion.
- [x] Validar `state` y reutilizar el mismo redirect URI en callback.
- [x] Derivar el callback desde el host actual y documentar `GOOGLE_OAUTH_BASE_URL` como override opcional.
- [x] Correr lint/build, commitear y pushear.

## Resultado

- El inicio OAuth de Google Business ahora envia `state` y PKCE (`code_challenge_method=S256`).
- El callback valida `state` y usa el mismo redirect URI guardado en cookie httpOnly.
- El redirect URI se deriva del host actual; `GOOGLE_OAUTH_BASE_URL` queda como override opcional para proxies.
- La pantalla Google Local muestra errores de callback en castellano.
- `npm run lint` y `npm run build` finalizaron correctamente.
- Verificacion local: `/api/google-business/auth` devuelve 307 a `accounts.google.com` con `state`, `code_challenge` y cookies OAuth.

---

# En progreso - Publicacion automatica en Instagram (Graph API)

## Objetivo

El Estudio de contenido genera caption + placa visual pero requiere copiar/publicar
manualmente en Instagram (nota existente en el editor: "Instagram requiere copiar/publicar
manualmente hasta conectar Instagram Graph API"). Investigacion de repos publicos (insta-p8,
MIT, mismo stack Next.js+Supabase) confirmo el patron correcto: Instagram API with Instagram
Login (graph.instagram.com), sin necesidad de Facebook Page.

## Plan

- [x] Revisar patron OAuth existente de Google Business para replicarlo.
- [x] Migracion: bucket publico de Supabase Storage para las placas generadas.
- [x] `src/lib/instagram-oauth.ts` — state/PKCE/cookies (mismo patron que google-oauth.ts).
- [x] `src/lib/instagram-business.ts` — tokens (app_config) + media container/publish helpers.
- [x] Rutas API: auth, callback, status, disconnect, publish.
- [x] UI: boton "Publicar en Instagram" en el editor + estado de conexion.
- [x] Documentar setup OAuth de Meta en CLAUDE.md (igual que Google Business).
- [x] Lint, build, commit y push.

## Resultado

- Bucket `content-media` (publico, solo service role escribe) vía migracion.
- Conexion Instagram Business vía OAuth con Instagram Login, tokens de larga duracion
  guardados/refrescados en `app_config` (mismo patron que Google).
- Publicar sube la placa generada al bucket, crea el media container, hace polling del
  estado y publica (feed post o story segun formato).
- Boton "Publicar en Instagram" visible cuando el item esta aprobado, tiene placa generada
  y el formato es post/historia (reel/carrusel quedan para una fase futura con soporte de video/multi-imagen).

---

# Especializaciones y enfermedades tratadas de la doctora

## Objetivo

Cargar en la base de la app las especializaciones ("Especialista en: Ecocardiografía,
Electrocardiografía, Cardiología Adulto") y las enfermedades tratadas (Angina de pecho,
Arritmias, Desmayo, Embolismo pulmonar, Endocarditis, Enfermedad de Chagas, Enfermedad
coronaria, Enfermedad valvular, Enfermedad de las arterias carótidas, Espasmo arterial,
Hipertensión arterial, Insuficiencia cardiaca, Soplo cardiaco, Infarto) que el usuario
compartió desde la ficha profesional de Lucía, y mostrarlas también en la web pública.

## Plan

- [x] Agregar `specializations` y `conditions_treated` al tipo `Doctor` y a la card
      "Datos de la doctora" en Configuración (editable con `StringList`, mismo patrón
      que "Prácticas" y "Obras sociales").
- [x] Mostrar ambas listas en la landing pública (todas las rutas `/[slug]`), con
      fallback a los valores cargados si `app_config.doctor` todavía no los tiene.
- [x] Sumar `knowsAbout` al JSON-LD `Physician` de la landing principal para SEO.
- [x] Migración `supabase/migrations/20260703_doctor_specializations.sql` que agrega
      los datos a `app_config` (`update ... value || jsonb` + `insert ... on conflict do nothing`
      como respaldo si la fila no existe).
- [x] Actualizar el seed de `docs/schema.sql` para instalaciones nuevas.
- [x] `npm run lint` y `npm run build` finalizaron correctamente.

## Nota importante

- Esta sesión no tenía `.env.local` en el proyecto, así que **no se pudo correr
  `npm run migrate` contra Supabase**. Falta ejecutarlo (o correr el SQL de
  `supabase/migrations/20260703_doctor_specializations.sql` a mano en el SQL Editor
  de Supabase) para que los datos queden persistidos en producción.
- Mientras tanto, la landing pública ya muestra estos datos gracias al fallback
  hardcodeado en `src/app/landings/[slug]/page.tsx`, así que el sitio no se ve afectado.

---

# Instagram Business Discovery — scope nuevo para consultar cuentas públicas

## Objetivo

El usuario preguntó si se podía consultar información pública de otra cuenta de Instagram
(@cinme.ar, la de CIMEL Lanús) vía la Instagram Graph API. Se confirmó que el token ya
conectado (`@draluciachahin`) no tenía el scope necesario: Meta devolvió
`"Tried accessing nonexisting field (business_discovery)"` al probar el endpoint.

## Cambios

- [x] Sumado `instagram_business_manage_insights` a `SCOPES` en
      `src/app/api/instagram-business/auth/route.ts`.
- [x] Agregado `getBusinessDiscovery(token, username)` en `src/lib/instagram-business.ts`
      (mismo patrón que `getProfile`) — consulta `followers_count`, `media_count`,
      `biography`, `website`, `profile_picture_url` de cualquier cuenta Business/Creator
      pública por username.
- [x] `npm run build` y `npm test` (165 tests) sin errores.
- [x] Rama + PR + merge (ver resumen técnico del PR).

## Pendiente (acción del usuario — no la puede hacer el agente)

- **Reconectar Instagram** una vez desplegado el cambio: Estudio de contenido → Instagram
  conectado → Desconectar → "Conectar Instagram" de nuevo, autorizando con la cuenta de
  Lucía. Meta exige reautorizar cuando cambia el scope pedido; el token actual sigue
  vigente para publicar pero no tiene permiso para Business Discovery hasta reconectar.
- Una vez reconectado, avisar para correr la consulta real contra `@cinme.ar` (o el
  username real de CIMEL si "cinme.ar" no es exacto) y reportar los datos.
- Intento de agregar una regla de permisos en `settings.json` para no pedir aprobación en
  futuros scripts de solo lectura contra producción: bloqueado por el clasificador de
  auto-mode (no puede distinguir "solo lectura" de "escritura" a nivel de patrón de
  comando de shell). Sigue pendiente pedir aprobación puntual cada vez, salvo que el
  usuario agregue esa regla manualmente él mismo en `.claude/settings.local.json`.
