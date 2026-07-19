# Lule Growth OS — Contexto para Claude

## Estado actual
- 2026-07-19 (ajuste de calidad, no bug: las placas de temas de consultorio no parecían de consultorio):
  Seba notó, mirando la Biblioteca, que la placa de "Un estudio simple para tu tranquilidad" (tema:
  ecocardiograma) mostraba el transductor del eco apoyado sobre una mesa ratona en lo que parece un
  living, sin ningún contexto médico alrededor — no comunica que se trata de un estudio en consultorio.
  Causa: `IMAGE_PROMPT_RULES` (`src/lib/ai.ts`) tenía una regla general "la imagen debe sentirse cercana
  y confiable, no fria, hospitalaria..." con ejemplos de escena siempre domésticos (cocinar, tomarse la
  presión en casa, salir a caminar) — correcto para temas de hábitos/prevención, pero sin ninguna
  distinción para categorías que SÍ son un procedimiento real de consultorio (Ecocardiograma, Consulta
  cardiológica, Estudios cardiológicos, Chequeo cardiovascular, atención en sedes). El modelo terminaba
  aplicando el mismo criterio "hogareño" a un tema que necesitaba mostrar el consultorio. Fix: se separó
  la regla en dos ramas explícitas dentro de `IMAGE_PROMPT_RULES` — temas de procedimiento/consulta en
  consultorio ahora piden explícitamente un consultorio o sala de estudios reconocible (camilla, el
  equipo correspondiente al estudio mencionado, ambiente clínico profesional pero cálido — luz natural,
  madera, plantas, nunca frío/institucional tipo guardia); temas de hábitos/prevención sin procedimiento
  en consultorio siguen usando la escena doméstica cotidiana de antes. Un único const (usado por
  `buildContentPlanPrompt`, `generateContentPlan` y `regenerateImageDirection`), así que el fix aplica a
  los tres generadores con un solo cambio. **Verificado en vivo** con dos llamadas reales a Gemini
  (mismo pedido — categoría Ecocardiograma, mismo tema — comparando las reglas viejas contra las nuevas,
  vía script temporal descartado después): con las reglas viejas, el `image_prompt` describía el
  transductor "resting gently on a light wooden table" con la clínica "softly blurred" de fondo (el bug
  reportado); con las reglas nuevas, describe "a warm, modern cardiology examination room... a
  professional medical stretcher... next to a modern ultrasound machine" manteniendo la estética cálida
  (luz natural, madera, una planta) en vez de un hospital frío. No se regeneraron las placas ya
  aprobadas/publicadas existentes — el fix aplica hacia adelante, a la próxima vez que se genere o
  regenere la dirección visual de una pieza. `npm test` (884/884), lint y build OK. Archivo:
  `src/lib/ai.ts`.
- 2026-07-19 (aviso de tema repetido: solo aprobadas/publicadas + ventana de 15 días): Seba reportó
  que el aviso amarillo "Ya generaste algo sobre esta categoría..." (Estudio de contenido, al elegir
  categoría antes de generar) saltaba apenas generaba un post nuevo — `findRecentDuplicateTopic`
  (`src/lib/content-pipeline.ts`) solo excluía piezas `archived`, así que un borrador recién creado
  (la pieza que se acaba de generar) ya contaba como "duplicado" contra sí mismo/lo anterior. Ahora
  solo considera piezas `approved`/`published` (un borrador todavía puede descartarse o cambiar de
  tema, no es una repetición real) y la ventana bajó de 30 a 15 días (`DEFAULT_DUPLICATE_TOPIC_WINDOW_DAYS`).
  Tests nuevos/actualizados en `content-pipeline.test.ts` (ignora borradores; detecta publicadas;
  ventana default 15 días). `npm test` (882/882), lint y build OK. Archivos:
  `src/lib/content-pipeline.ts` (+tests), `src/app/(app)/contenido/instagram/page.tsx` (comentario).
- 2026-07-19 (bug real: categoría libre mal interpretada por la IA — "Investigación medica" generó
  contenido sobre electro vs eco): Seba escribió "Investigación medica" como categoría (texto libre,
  no es una de las predefinidas), dejó el tema vacío, y "Generar propuesta completa" devolvió una
  pieza sobre "diferencia entre electrocardiograma y ecocardiograma" — sin ninguna relación con
  investigación científica/ensayos clínicos. **Investigado a fondo antes de tocar código** (consultas
  de solo lectura a producción, sin PII — contenido de marketing, no datos de pacientes): se descartó
  caché (no había ninguna fila en `ai_outputs` para ese prompt; el hash de `generateText` incluye la
  categoría, cada categoría distinta genera un hash distinto) y se descartó reutilización de un item
  ya aprobado (la única pieza con esa categoría en la Biblioteca es justamente ese borrador nuevo). Es
  una generación real y fresca de Gemini que interpretó mal la categoría: el prompt solo decía
  `Categoría: ${category}` sin ninguna instrucción de mantenerse fiel al significado literal de una
  categoría libre, y el modelo derivó hacia un tema cardiológico más conocido/cómodo ("estudios") en
  vez de "investigación médica" en el sentido de evidencia científica. Fix: nueva regla
  `CATEGORY_COHERENCE_RULES` en `src/lib/ai.ts`, sumada tanto al prompt de modo manual
  (`buildContentPlanPrompt`) como al system prompt de `generateContentPlan` — instruye a interpretar
  la categoría de forma literal, no reemplazarla por la más conocida/cómoda, y usa el propio caso real
  (Investigación médica vs. Estudios cardiológicos) como ejemplo concreto de desambiguación. Aplica a
  cualquier categoría, no solo a esta. **Verificado en vivo contra el escenario exacto reportado**
  (mismo texto de categoría, tema vacío, llamada real a Gemini vía script temporal descartado después):
  con el fix, la misma categoría generó contenido genuinamente sobre evidencia científica ("Ciencia
  vs. mitos", "la investigación médica es el motor que nos permite a los cardiólogos saber con
  seguridad qué tratamientos salvan vidas..."), no sobre electro/eco. **Hallazgo secundario, no
  corregido, solo para que Seba lo sepa**: en la misma investigación se confirmó por los logs de
  `ai_requests` que cuando Gemini falló hoy más temprano (el bug de JSON truncado corregido antes en
  esta misma sesión) **no hubo ningún intento de fallback a Anthropic** pese a que `AI_PROVIDER=""`
  (modo auto) y ambas API keys están configuradas — la lógica de `generateText` en el código sí
  contempla ese fallback, así que lo más probable es que el proceso local de `npm run dev` tenga en
  memoria un valor viejo de `AI_PROVIDER` desde antes de que se editara `.env.local` a `""` (las env
  vars no siempre se recargan en caliente para código de servidor). Reiniciar `npm run dev` si se
  quiere confirmar que el fallback a Anthropic funciona de verdad. `npm test` (884/884), lint y build
  OK. Archivos: `src/lib/ai.ts` (+tests en `ai.test.ts`).
- 2026-07-19 (bug real: "Generar propuesta completa" fallaba con "No se pudo generar la respuesta con
  IA", Seba reportó "rompiste algo" tras la sesión anterior): **investigado y confirmado que NO fue
  causado por ningún cambio de esta sesión** — `/api/content/route.ts` (el que genera) solo importa
  de `ai.ts`, `supabase/server` y `staff-authz`, nada de lo tocado antes (repetición/orden de la
  Biblioteca). Causa real, preexistente: Gemini (`gemini-3.5-flash`) a veces devuelve, en modo JSON,
  texto **no vacío pero truncado a mitad de un string** (`finishReason: "STOP"`, muy por debajo del
  límite de tokens — no es un problema de `maxTokens` ni del prompt; confirmado en vivo: 1 de 4
  llamadas idénticas truncó, las otras 3 salieron perfectas — intermitente). `generateWithGemini` no
  lo detectaba (solo lanza si el texto viene vacío), así que `generateText` lo **cacheaba y logueaba
  como éxito**; la falla real recién aparecía un nivel arriba, en el `JSON.parse` de
  `generateContentPlan`, con un mensaje que no matcheaba ningún caso de `getPublicAiError` y mostraba
  el genérico de "revisá la configuración" — engañoso, la configuración estaba bien. Fix en
  `generateText` (`src/lib/ai.ts`): si `options.json`, valida `JSON.parse(text)` **antes** de cachear
  y de loguear éxito; si falla, lo trata como falla real de ese proveedor → dispara el fallback
  automático al siguiente proveedor del loop (Anthropic, ya configurado) en vez de propagar el JSON
  roto. Beneficia a los 5 usos de `json:true` (content_plan, classify, whatsapp_intent —el respaldo de
  IA del bot—, instagram_content, image_direction), no solo Estudio de contenido. Nuevo caso en
  `getPublicAiError` para el mensaje claro "revisa la config" → "respuesta incompleta, probá de
  nuevo" si algún día se agotan todos los proveedores igual. **Bug secundario encontrado en el
  camino**: como el JSON truncado se cacheaba ANTES del fix, mi primera reproducción del bug (antes de
  aplicarlo) dejó una fila envenenada en `ai_outputs` bajo el hash exacto de ese prompt (determinístico:
  misma categoría + tema vacío) — la borré de producción con aprobación explícita de Seba (`DELETE`
  de una sola fila, sin PII, tabla de caché de IA). Verificado en vivo (Playwright + E2E) contra el
  escenario EXACTO de la captura de Seba (categoría "Consulta cardiologica", sin tema, Objetivo
  Confianza, Post estático): antes del fix, 5/5 intentos daban el error; con el fix + caché limpia,
  HTTP 200 con contenido real. 3 tests nuevos en `src/lib/ai.test.ts` (JSON truncado rechaza y da el
  mensaje claro; JSON completo sigue funcionando igual, mockeando `@supabase/supabase-js` para no
  tocar la base real). `npm test` (880/880), build y lint OK.
- 2026-07-19 (card de repetición + orden cronológico de la Biblioteca): a pedido de Seba, (1) la card
  de una pieza marcada para repetirse ahora muestra **cuándo se publica y cuándo deja de publicarse**:
  "Se repite · próxima: [fecha]" y, si tiene límite, "deja de publicarse ~[fecha] ([N] repeticiones)"
  (o "no deja de publicarse hasta que la desactives" sin límite). La fecha de fin la estima
  `estimateRepeatEndDate` (nueva, pura, con tests: proyecta `1 + repeat_limit` apariciones menos las ya
  hechas sobre los días del cronograma). (2) La Biblioteca se ordena **cronológicamente por la fecha
  estimada de PUBLICACIÓN** (la que muestra cada card, "próxima/estimado X"), de la más próxima a la
  más lejana, intercalando formatos — antes las Aprobadas iban por posición en la cola de cada formato
  (se leía como "agrupado por tipo") y un primer intento por `created_at` tampoco servía porque las
  fechas de publicación quedaban desordenadas (20, 22, 23 y abajo 21 — lo reportó Seba). Ahora el sort
  usa `queueInfo.date` / `repeatInfo.nextDate` (la misma fecha que se muestra); las piezas sin fecha
  estimada (borradores, archivadas, ya publicadas sin repetir) van al final por `created_at` desc.
  Las flechas de reordenar cambian `queue_rank` → cambian la fecha estimada → cambian el lugar en la
  lista. Verificado en vivo (Playwright + E2E): orden 20 jul → 21 jul → 22 jul → 23 jul, y la card
  muestra "Se repite · próxima: 20 jul / deja de publicarse ~[fecha] ([N] repeticiones)". `npm test`
  (877/877), build y lint OK. Archivos: `src/lib/content-pipeline.ts` (+tests),
  `src/app/(app)/contenido/instagram/page.tsx`, `docs/CONTENT_STUDIO.md`.
- 2026-07-19 (repetición aditiva: no compite con el cupo "Publicar de a N"): a pedido de Seba, las
  piezas marcadas para repetirse ya **no comparten el cupo `items_per_run`** con las nuevas — antes
  competían (la nueva ganaba y la repetida rellenaba lo que sobraba). Ahora `items_per_run` limita
  **solo las piezas nuevas aprobadas** y las evergreen vencidas se publican **además**, en la misma
  corrida: `pickNextPublishableItems` pasó de `[...aprobadas, ...evergreen].slice(0, count)` a
  `[...aprobadas.slice(0, count), ...evergreen]`. Ej: "Publicar de a 1" + una fija marcada = 2
  publicaciones por día programado (la nueva del cupo + la fija aparte). Se aclaró en la UI (control de
  repetición del editor y nota bajo "Publicar de a N") que la repetida sale además y que una historia
  sale como historia, no en el feed (`asStory = format === "historia"`, ya existente). Tests de
  `pickNextPublishableItems` actualizados a la semántica aditiva. `npm test`, build y lint OK. Archivos:
  `src/lib/content-pipeline.ts` (+tests), `src/app/(app)/contenido/instagram/page.tsx`,
  `docs/CONTENT_STUDIO.md`.
- 2026-07-19 (repetir historia fija: bug de guardado + rediseño del control): el campo "Repetir esta
  pieza sola cada X días" del editor de contenido **no se podía guardar** — `repeat_interval_days` no
  estaba en `EDITABLE_FIELDS`, así que "Guardar cambios" nunca se habilitaba y `saveChanges()` lo
  descartaba (el backend siempre lo aceptó; el bug era 100% del front). A pedido de Seba se cambió el
  control de "cada X días" (que se pisaba con los días del cronograma del track) a un **interruptor
  on/off + límite opcional de repeticiones**: al prender guarda `repeat_interval_days = 1` (= elegible
  en cada corrida programada; los días/veces por semana los sigue decidiendo el cronograma del track),
  `repeat_limit` (nuevo, opcional, tope de reposteos; vacío = sin límite) y `repeat_count` (nuevo,
  system-managed: lo incrementa el cron al republicar con éxito, se resetea a 0 al re-activar). El
  guardado ahora va por el mismo camino probado (`onSave`→PATCH) que Aprobar/Volver a borrador. Sin
  migración (las piezas viven como JSON en `app_config`). `isRepeatDue` respeta el límite. (La relación
  con el cupo `items_per_run` cambió el mismo día — ver la entrada de "repetición aditiva" arriba: las
  repetidas se publican además de las nuevas, no compiten por el cupo.)
  **Verificado en vivo** con Playwright + la cuenta E2E contra la pieza real "TU CONTROL
  CARDIOVASCULAR": se prendió, se puso límite 8, se recargó la página y al reabrir seguía "Activada"
  con límite 8 (persiste de verdad), y se restauró el estado original. `npm test` (871/871), build y
  lint sin errores. Archivos: `src/types/index.ts`, `src/lib/content-pipeline.ts` (+tests),
  `src/app/api/content/items/route.ts`, `src/app/api/cron/publish-content/route.ts`,
  `src/app/(app)/contenido/instagram/page.tsx`, `docs/CONTENT_STUDIO.md`. Contexto de la limitación de
  links en historias por API sigue vigente (sin sticker de link; usar QR/texto o mandar a Destacados).
- 2026-07-18 (Content-Security-Policy, cierra el trabajo futuro de TECH-01): `next.config.mjs`
  ahora manda un header CSP completo, armado desde el inventario real de lo que el navegador carga
  (gtag de GA4 con consentimiento, Supabase para login/MFA e imágenes de Storage, `data:` para el
  QR de MFA y previews — nada más; las reseñas de Places no traen fotos y el OAuth es redirect
  top-level que CSP no restringe). `script-src` mantiene `'unsafe-inline'` (Next inyecta scripts
  inline; nonce vía proxy queda como mejora futura) — el valor está en `connect-src`/`img-src`/
  `frame-src 'none'`/`form-action 'self'`. Dev suma `'unsafe-eval'`+ws (HMR); previews de Vercel
  permiten `vercel.live`. Verificado contra build de producción real: 19 tests públicos + los 3
  autenticados (login+TOTP, dashboard, inbox, leads) pasan con el CSP activo; landing sin errores
  de consola. GA no probado en vivo (sin measurement ID local) — allowlist oficial de GA4, revisar
  la consola del sitio real tras el deploy. El mismo día se registró la primera revisión del modo
  sombra (n=2, 100% match — sin señal para fase 2/canary hasta que Meta destrabe volumen real) y
  se reconcilió `docs/IN_PROGRESS.md` con los PRs #124/#126–#129 ya mergeados.
- 2026-07-17 (clasificador v2 conectado en modo sombra, PR #116): `whatsapp-policy-shadow-runner.ts`
  llama a `evaluateWhatsAppPolicy()` (`whatsapp-policy.ts`, construido el 16/07 pero nunca conectado)
  en paralelo a cada mensaje real, sin ningún efecto sobre la respuesta al paciente — corre desde un
  único punto de entrada en `handleIncomingMessage`, envuelto en try/catch que nunca puede afectar el
  flujo real. Cobertura fase 1, deliberadamente parcial: solo las categorías de seguridad/derivación
  con equivalencia inequívoca contra el bot legacy (urgencia, baja de contacto, adjunto no soportado,
  límite clínico, derivación forzada por longitud, pedido explícito de humano, botones de protocolo,
  y los intents determinísticos de la conversación ya derivada que cierran o escalan) — el flujo
  conversacional rutinario de intake/sede/cobertura queda afuera a propósito, porque ahí el bot
  legacy no tiene un `response_key` comparable y forzar una equivalencia daría una métrica engañosa.
  Guarda solo hashes SHA-256 y enums cerrados en `whatsapp_policy_evaluations` (sin PII, RLS forzada,
  ya creada el 16/07); el hash de conversación reutiliza `hashWhatsAppPhone()` para que el trigger de
  erasure existente también la cubra. `shadow_mode_enabled` ya no se fuerza a `false` en
  `mergeWhatsAppSettings` (nuevo checkbox en Configuración → Bot de WhatsApp) y quedó activado en
  producción vía migración (`20260717_whatsapp_policy_shadow_enable.sql`, `jsonb_set` puntual, no
  reemplaza el objeto entero) a pedido explícito de Seba. `policy_rollout_percent` sigue bloqueado en
  0 — servirle v2 de verdad a un paciente sigue sin implementarse. Próximo paso: dejar acumular datos
  reales unos días y revisar la señal antes de decidir una fase 2 (ampliar cobertura) o un canary.
- 2026-07-17 (template de Meta aprobado): `alerta_interna_derivacion` pasó a `status: "aprobado"`
  — Meta aprobó la versión genérica de una sola variable (`CASO-…`, sin nombre ni motivo del
  paciente) del hardening del 16/07. Marcado "Aprobado" en Configuración → Templates de WhatsApp.
  La alerta interna por WhatsApp ante una derivación a humano ya funciona de verdad, no solo el
  email de respaldo. De los gates externos que quedaban (template, revisión legal, staging), este
  ya cerró — legal y staging siguen pendientes.
- 2026-07-17 (handoff UX): `taken_at` separa una derivación realmente pendiente de una conversación
  ya tomada. El Inbox muestra “Paciente respondió” sólo cuando el último mensaje posterior a la toma
  es entrante y limpia esa señal con la siguiente respuesta manual. Al reactivar, se envía un aviso
  administrativo fijo —sin IA—; si la ventana de Meta está cerrada o el envío falla, el estado se
  reactiva igual y la UI informa que el aviso no quedó confirmado.
- 2026-07-17: el Inbox conserva durante 30 días los mensajes entrantes posteriores a que una persona
  toma la conversación (`messages.retention_class = handoff_transient`). Esos textos sólo se exponen
  a roles autorizados con MFA, no pasan por IA y no producen respuestas automáticas; la barrida
  semanal existente los elimina sin sumar un cron. La cabecera móvil del Inbox apila identidad y
  acciones para evitar botones cortados.
- 2026-07-16 (**estado vigente del bot de WhatsApp; supersede las notas históricas de Ola 0/WA-02/WA-03 y DATA-02 que describen la implementación anterior**): el webhook valida firma sobre el body crudo, limita tamaño, normaliza con esquema cerrado y persiste un envelope mínimo en una cola durable. El worker usa leases, reintentos, DLQ, checkpoint `handler_completed_at` y ACK idempotente; no se vuelve a ejecutar el handler después de completar el efecto de negocio. Las salidas usan un outbox/ledger con identidad estable, CAS antes de Meta y cuarentena ante resultado ambiguo. El borrado crea tombstones HMAC y coordina writers/workers con advisory locks. La IA de WhatsApp solo puede devolver enums de clasificación validados: **nunca genera texto médico libre visible al paciente**, y todo contenido médico/sensible se responde con catálogo fijo determinístico sin persistir el texto. Presión arterial de alarma: sistólica `>180` o diastólica `>120`, con manejo de negación, antecedentes y terceros. El seguimiento requiere consentimiento específico `appointment_followup` vigente, además del estado/claim correspondiente. Los PR #96–#102 están mergeados; las diez migraciones están aplicadas y producción quedó verificada. El worker frecuente usa un único job `lule-whatsapp-worker-every-minute` de `pg_cron` (`* * * * *`) que invoca mediante `pg_net` la URL y el `CRON_SECRET` cifrados en Supabase Vault. Vercel Production fija `META_GRAPH_API_VERSION=v25.0`; el preflight read-only devuelve 200 y sólo códigos cerrados. `enforce_roles` y `require_mfa_for_sensitive_actions` están activos: existe una cuenta `owner` y una `doctor`, ambas con MFA verificado; dos cuentas deliberadamente sin rol quedan bloqueadas. El `owner` decidió operar sin segundo autenticador, por lo que perder el único factor requiere recuperación administrativa. CIMEL Lanús, Hospital Británico y Swiss Medical Lomas están activas y tienen evidencia individual vigente. `ALERT_WHATSAPP_TO` está configurado como sensible; `alerta_interna_derivacion` sigue `pendiente_meta`. Gates externos: aprobar el template en Meta, completar revisión legal y disponer de staging.
- 2026-07-16 (runbook de acceso): al activar el flag MFA, el gate central exige AAL2 antes de todo el CRM porque RLS protege también lecturas PII. Recuperación sin endpoint público: verificar identidad fuera de banda, eliminar el factor por Supabase Admin/Dashboard y reenrolar; nunca imprimir ni copiar secretos TOTP o PII. Ver `docs/WHATSAPP_SECURITY_ROLES_RETENTION.md`.
- 2026-06-11: Setup inicial del proyecto. MVP Fase 1 en construcción.
- 2026-07-05: Se sumó el Hospital Británico como tercera sede de derivación (miércoles), junto a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).
- 2026-07-06: Se eliminó `createServiceClient()` (bug de sesión pisando service_role, ver más abajo) migrando todas las rutas a `getServiceDb()`. Se ampliaron los eventos de landing (visitas + clicks por acción/sede), se agregó ranking de landings, link de seguimiento por pieza de contenido (utm_content) y reportes semanales automáticos en `/dashboard`.
- 2026-07-07: Estudio de contenido — Biblioteca ahora permite crear una pieza en blanco y completarla 100% a mano (sin pasar por generación con IA), incluyendo subir una imagen propia (`/api/content/upload-image`, guarda en `content-media` igual que las placas de Gemini). Cada track de "Publicación automática" (Posts/Historias) tiene su propia fecha de inicio opcional (`starts_at`): mientras no llegue, el cron no publica nada de ese track aunque esté activado, aunque no haya publicado nunca antes. Primer test real de publicación (post "Diagnóstico y seguimiento"): salió bien en Instagram; Google Business falló porque esta cuenta de Business Profile no expone `google_account_id` por API (limitación de Google, no del código — pasa cuando la cuenta conectada no es Owner directo del perfil, o el perfil quedó agrupado bajo otra organización). Se decidió sacar Google Business del frente de Estudio de contenido (canal de auto-publish, textarea, botones "Solo/Publicar en Google", banner de publicación manual) y enfocar todo en Instagram — el código de `google-business.ts`, `content-publish.ts`, la ruta `/api/content/publish-now` y `resolveChannelsToPublish` siguen siendo genéricos multi-canal por si se retoma más adelante (alcanza con volver a incluir `"google_business"` en `channels`/`auto_publish_settings`). La página `/google-local` (perfil, horarios, reseñas) no se tocó, sigue funcionando aparte.
- 2026-07-08: Publicación automática — cada track (Posts/Historias) ahora elige días de la semana concretos (`days_of_week`) en vez de solo una frecuencia flotante; los cronogramas ya activados en producción quedaron sin días elegidos hasta que alguien los marque a mano en la UI (no publican nada hasta ese paso). Se sumó `items_per_run` (Historias puede publicar varias piezas juntas por corrida, ej. las 3 sedes) y `queue_rank` para reordenar a mano el orden de publicación, con flechas y un badge de "próxima en publicarse / fecha estimada" por card en Biblioteca. También se agregó un selector para cambiar el `format` de una pieza ya creada (antes quedaba fijo desde la creación) — al guardarlo sobre una pieza aprobada la revierte a Borrador en silencio (mismo mecanismo de siempre para piezas editadas), pendiente real en `docs/BACKLOG.md`: ese aviso solo existe hoy para piezas publicadas, falta extenderlo a las aprobadas.
- 2026-07-10/11: Se sumó el scope `instagram_business_manage_insights` al OAuth de Instagram y `getBusinessDiscovery()` en `src/lib/instagram-business.ts`, con la hipótesis de habilitar Business Discovery (consultar datos públicos de otras cuentas por username, caso de uso: comparar contra @cinme.ar de CIMEL Lanús). **Hipótesis descartada tras reconectar**: el campo `business_discovery` sigue devolviendo `"Tried accessing nonexisting field"` incluso ya con el scope nuevo y probando contra la propia cuenta conectada (no es un tema de permisos ni de la cuenta consultada) — Business Discovery simplemente no existe en `graph.instagram.com` ("Instagram API with Instagram Login"), es exclusivo de la API clásica de Instagram Graph atada a una Facebook Page, que este proyecto evita a propósito (ver setup OAuth abajo). El scope queda igual sumado (es inofensivo y puede habilitar otros campos de insights a futuro), pero **no hay forma de traer datos de otras cuentas de Instagram sin vincular una Facebook Page** — cambio estructural mayor, no se hizo sin pedirlo explícitamente.
- 2026-07-11: Seba compartió un plan externo (benchmark de perfiles médicos + propuesta de arquitectura) para mejorar el Estudio de contenido. Gap-analysis contra el código real en `docs/BACKLOG.md` → "[ANÁLISIS] Plan de mejoras de Instagram". Se implementaron los 4 items de bajo esfuerzo que resultaron viables: **objetivo editorial seleccionable** (alcance/educación/confianza/conversión, reemplaza el `goal` que estaba hardcodeado siempre al mismo texto — ver `ContentObjective` en `src/types/index.ts`), **pilares clínicos** (se expandió `CATEGORIES` en `page.tsx` en vez de sumar un campo nuevo), **guion estructurado para reel silencioso** (`scenes`: texto en pantalla + dirección de toma por escena, generado por la IA solo para `format === "reel"` y editable a mano — sigue sin generarse video real, reels siguen sin auto-publish por API igual que antes) y **detección de tema repetido** (`findRecentDuplicateTopic` en `content-pipeline.ts`, aviso no bloqueante si se repite categoría/hook en 30 días). Un quinto item (funnel de atribución leads/turnos por pieza) se descartó al implementar: `leads.utm_content` nunca se completa hoy con un valor real (el único escritor, `/api/public/lead`, no tiene ningún llamador desde que se revirtió el formulario público de leads el 2026-07-04) — construirlo hubiera mostrado "0 leads" siempre, de forma engañosa.
- 2026-07-11 (SEC-02/CRM-01 de `docs/BACKLOG.md`): export CSV de leads (`/api/leads/export`) ahora neutraliza inyección de fórmulas (`src/lib/csv.ts`) — una celda que empiece con `=`, `+`, `-`, `@`, tab o retorno de carro se antepone con comilla simple antes de abrirla en Excel/Sheets. Y `/api/ai/suggest` (botón "Sugerir mensaje de seguimiento" del Inbox) corrigió un bug real: pedía los primeros 20 mensajes de la conversación (`.order(asc).limit(20)`) en vez de los últimos 20, así que en una conversación larga la IA armaba la sugerencia con contexto viejo, sin ver los mensajes más recientes. Ahora usa `.order(desc).limit(20)` + `toChronologicalContext()` (`src/lib/conversation-context.ts`) para traer el tramo más reciente en orden cronológico.
- 2026-07-11 (mismo día): a pedido explícito de Seba, se resolvió punta a punta la publicación de **carruseles** por API de Instagram (antes bloqueados igual que los reels). Un carrusel ahora necesita una imagen propia por slide (no solo la portada) — nueva tarjeta "Placas de cada slide" en el editor, genera todas juntas o de a una, reusando la misma dirección visual (`image_prompt`) con el titular/texto de cada slide. Aprobar un carrusel exige portada + todas las slides con imagen (validado server-side en `/api/content/items` PATCH, no solo en la UI). Se agregó un tercer track de auto-publicación (`carrusel`, además de `post`/`historia`) que corre dentro del mismo cron — no suma un cron job nuevo de Vercel. `publishCarouselToInstagram` en `src/lib/instagram-business.ts` implementa el flujo real de Meta (contenedor hijo por imagen → contenedor padre `CAROUSEL` → publish), con las esperas de cada imagen en paralelo (no secuencial) para no arriesgar el timeout. El reel sigue sin poder auto-publicarse: sigue siendo la única limitación real (requiere video, la app no genera ni acepta video). Detalle completo en `docs/CONTENT_STUDIO.md` → "Carruseles". Una revisión de código con dos agentes en paralelo encontró y corrigió una condición de carrera real (generar/editar dos slides en simultáneo podía pisar el resultado de una con la otra) — se resolvió serializando todas las acciones que tocan `slides` detrás de un único flag `carruselBusy` mientras hay una generación en curso, y guardando progresivamente en la generación masiva (si falla a mitad de camino, lo ya generado no se pierde).
- 2026-07-11 (SEC-01 parcial de `docs/BACKLOG.md`): el rate limit anti-spam de `/api/public/lead` y `/api/public/click` dejó de vivir en un `Map` en memoria (se reseteaba por instancia serverless de Vercel, así que el límite real era `maxRequests × instancias activas`) y pasó a Postgres vía RPC `check_rate_limit` (`src/lib/rate-limit.ts`, migración `20260711_rate_limit_distributed.sql`) — ventana fija compartida entre todas las instancias, atómica por UPSERT. Fail-open si la consulta a la base falla. Queda pendiente la parte más grande de SEC-01 (esquemas de validación uniformes para todos los cuerpos/query params de la API) — no se abordó todavía por ser un esfuerzo transversal grande sobre decenas de rutas.
- 2026-07-11 (GROWTH-02 de `docs/BACKLOG.md`): el panel "Test A/B: hero de la landing principal" en `/dashboard` ahora muestra explícitamente el criterio de finalización (mínimo 150 visitas por variante y 8 puntos de diferencia de interacción, `AB_TEST_MIN_VISITS_PER_VARIANT`/`AB_TEST_MIN_RATE_GAP` en `growth-recommendations.ts`) y un aviso de estado (`evaluateAbTestReadiness()`, con test): "muestra insuficiente" (con cuántas visitas faltan por variante), "sin señal clara todavía", o "hay señal suficiente". El motor de reglas ya evitaba recomendar un ganador con tráfico insuficiente desde antes (`checkHeroAbTestSignal`) — lo que faltaba era mostrarlo en el panel mismo, no solo como recomendación aparte.
- 2026-07-11 (DATA-03 de `docs/BACKLOG.md`): Google Analytics ahora requiere consentimiento explícito antes de cargarse — `src/components/analytics-consent-banner.tsx` muestra un banner (solo si `NEXT_PUBLIC_GA_MEASUREMENT_ID` está configurado y todavía no hay decisión guardada) con botones Aceptar/Rechazar que escriben la cookie `lule_analytics_consent`; `GoogleAnalytics` (`src/components/google-analytics.tsx`) ahora es un server component async que lee esa cookie con `next/headers` y no renderiza el script de GA si no está en `"granted"`. Es el default más conservador (opt-in) mientras no haya una decisión de asesoría legal confirmando que no hace falta pedir consentimiento para esta audiencia — esa revisión legal en sí sigue pendiente. `/privacidad` → "Cookies y analítica" actualizada para describir el flujo real.
- 2026-07-11 (DATA-01 de `docs/BACKLOG.md`): publicada `/privacidad` (`src/app/privacidad/page.tsx`) — política de privacidad marcada explícitamente como **borrador** (banner visible, pendiente de validación por asesoría legal, dato de salud) que describe qué se recolecta, para qué, con qué terceros se comparte (Meta/WhatsApp, Anthropic/Google como proveedores de IA, Supabase, Vercel, Google Analytics) y cómo pedir acceso/corrección/borrado (hoy manual, por WhatsApp). Enlazada desde el footer de todas las landings, sumada a `sitemap.ts`/`robots.ts`. **Bug real encontrado y corregido de paso**: la página quedaba atrapada por el middleware de auth (`isPublicRoute` no incluía `/privacidad`, hoy en `src/proxy.ts` — ver `middleware.ts` → `proxy.ts` más abajo) y redirigía a `/login` — cualquier página pública nueva fuera de `PUBLIC_LANDING_SLUGS` tiene este mismo riesgo, tenerlo en cuenta si se agrega otra.
- 2026-07-12 (PERF-01 de `docs/BACKLOG.md`): las dos queries del dashboard que traían hasta 20.000 filas crudas de `landing_events` y contaban en JavaScript (`getLandingRanking`, `getHeroVariantResults`) pasaron a agregarse en Postgres vía RPC (`landing_events_ranking`, `landing_hero_variant_results`, migración `20260712_landing_events_aggregation.sql`, `GROUP BY` + `COUNT FILTER`, sin tope artificial). El límite de 20.000 no era solo performance: si el tráfico real de 90 días lo superaba, el conteo quedaba subestimado en silencio. **No se pudo verificar visualmente `/dashboard`** (requiere sesión, sin credenciales de login en este entorno) — validado por revisión manual de que ambas funciones SQL replican exactamente los mismos filtros que el código que reemplazan, más build/tests. **Sigue pendiente**: paginar `/leads` (tope fijo de 300 sin UI de paginación) y `/api/leads/export` (sin límite) — no abordado, es un cambio de UI más grande.
- 2026-07-12 (QA-01 parcial de `docs/BACKLOG.md`): se agregó un patrón de tests de integración para rutas de API (`src/app/api/**/route.test.ts`, ver "Tests" más abajo), con 3 rutas cubiertas como referencia (`leads/[id]`, `leads/export`, `cron/weekly-report`). **Bug real de infraestructura de testing encontrado primero**: `jest.config.js` no tenía `moduleNameMapper` para el alias `@/` — `jest.mock("@/lib/x")` no resolvía en absoluto (un `import` normal sí funciona porque Next lo reescribe en compilación, pero `jest.mock()` recibe un string literal que Jest debe resolver solo). Sin corregir esto, no se podía mockear ningún módulo con alias `@/` en ningún test de ruta — bloqueaba QA-01 de raíz. Ya corregido. Los tests nuevos verifican, con mocks (no contra la base real): que `/api/leads/[id]` PATCH no deja inyectar `id`/`created_at` por el body saltando la allowlist, que `/api/cron/weekly-report` es fail-closed sin `CRON_SECRET`, y que la neutralización de fórmulas de SEC-02 sigue funcionando end-to-end en la respuesta real de `/api/leads/export`. Sigue pendiente extender el mismo patrón al resto de rutas críticas (esfuerzo grande, pero ya no bloqueado — el patrón funciona).
- 2026-07-12 (OPS-01 parcial de `docs/BACKLOG.md`): los callbacks de OAuth (`google-business/callback`, `instagram-business/callback`) tenían `catch` completamente silenciosos ante fallos reales (intercambio de token, descubrimiento de cuenta/ubicación de Google) — se agregó `console.error` con ruta/etapa/mensaje (nunca tokens ni client secret, solo la respuesta de error de la API de Google/Meta). Gran parte de OPS-01 ya estaba resuelta de antes sin que hiciera falta este ticket explícito: alertas por email de webhook (WA-03) y crons (2026-07-07), y el "panel de salud" que pedía el ticket ya lo cumple `growth-recommendations.ts` en `/dashboard`. **Investigación que no encontró lo que parecía haber**: al principio pareció que `/google-local`/`/contenido/instagram` ignoraban los query params de error del redirect de OAuth — revisando a fondo, ambas páginas ya los leen y muestran un aviso (no hacía falta tocar nada ahí). Sigue pendiente estandarizar logs en el resto de rutas internas (esfuerzo grande, mismo motivo que SEC-01 resto).
- 2026-07-12 (QA-01, segundo incremento): se extendió el patrón de tests de integración de rutas a `GET/POST /api/webhooks/whatsapp` (`src/app/api/webhooks/whatsapp/route.test.ts`) — la ruta más crítica del proyecto, la única que recibe tráfico no autenticado de Meta y dispara al bot conversacional real. Mockea `whatsapp-webhook-signature`, `whatsapp-idempotency`, `whatsapp-bot` y `alert-email` (nunca pega a Supabase). Cubre: verificación GET de Meta (challenge correcto/token incorrecto), WA-01 (401 sin firma válida), JSON inválido (400), objeto que no es `whatsapp_business_account` (se ignora), WA-02 (un evento duplicado no vuelve a disparar el bot) y WA-03 (falla transitoria → 500 para que Meta reintente; falla permanente → 200, no reintenta). El patrón ya cubre 4 rutas distintas; extenderlo al resto sigue siendo mecánico pero son varias rutas más.
- 2026-07-12 (SEC-01 parcial #2 de `docs/BACKLOG.md`): se sumó `zod` (nueva dependencia) para validar los cuerpos de las dos rutas públicas sin sesión (`/api/public/lead`, `/api/public/click`) — las de mayor riesgo real, un atacante llega a ellas sin necesitar cuenta. `/api/public/lead` no tenía ninguna validación de tipo/longitud antes de esto (nombre/motivo de cualquier tamaño se guardaban tal cual, y `requested_service`/`preferred_location` no se chequeaban contra los enums reales de `src/types/index.ts`). `/api/public/click` ya validaba `event_type` a mano pero no `slug` (podía ensuciar `landing_events` con slugs inventados). Helper compartido en `src/lib/api-validation.ts` (`parseJsonBody`/`formatZodError`, con tests) para que un JSON inválido devuelva `400` en vez de un `500` genérico, y para no reenviar mensajes de error de Supabase tal cual al cliente. Verificado en vivo con `curl` contra el dev server real (sin sesión, son rutas públicas) que los 4 caminos de rechazo devuelven `400` — no se probó el camino exitoso en vivo a propósito, para no insertar datos de prueba en la base de producción real. **Sigue pendiente**: el resto de las rutas (todas requieren sesión, menor riesgo, pero son decenas) — esfuerzo grande para abordar aparte.
- 2026-07-12 (SEC-01, tercer incremento — **cierra el ticket**): recorridas las ~24 rutas de `src/app/api/**` que reciben un body JSON del cliente. **Hallazgo real más importante**: `/api/experiments` (POST) y `/api/experiments/[id]` (PATCH) hacían `insert([body])`/`update(body)` **sin ningún filtro de campos** — mass assignment más grave que el de `/api/leads`, que al menos ya tenía un allowlist manual. Corregido con schemas de zod que además actúan como allowlist (`src/app/api/experiments/route.ts`, `src/app/api/experiments/[id]/route.ts` — el PATCH ahora solo acepta `result`/`winner`, lo único que envía la UI). También se agregó validación de tipo/longitud/enum a `/api/leads` (POST) y `/api/leads/[id]` (PATCH) — mismo problema que ya se había resuelto en `/api/public/lead` — compartiendo un único schema nuevo (`src/lib/lead-schema.ts`) entre alta y edición. `/api/whatsapp/templates/[id]` y `/api/checklist` (PATCH) ahora validan sus enums reales (status de template, item_key del checklist) contra la base — antes aceptaban cualquier string y podían ensuciar esas tablas con valores que ninguna pantalla sabe interpretar. `/api/messages`, `/api/classify`, `/api/followup`, `/api/ai/suggest` ahora validan tipo/longitud de `lead_id`/`content`/`message` (ninguno toca lógica médica, solo enrutamiento/clasificación). El resto de rutas ya tenían validación manual sólida (`google-business/profile`, `select-location`, `posts`, `reviews/[reviewId]/reply`, `content/reorder`, `content/publish-now`, `content/upload-image`, `whatsapp/pricing/[id]`, `config`) — el gap real ahí era que `request.json()` no estaba protegido (JSON inválido tiraba una excepción no controlada en vez de un `400` claro), corregido envolviendo con `parseJsonBody`. **Deliberadamente sin tocar**: `content/items`, `content/visual`, `content/alt-text`, `content/image-direction`, `content/route`, `instagram-business/publish` — ya tenían validación manual extensa (enums, límites de longitud, envueltos en `try/catch`) y reescribirlas a zod no sumaba seguridad real, solo riesgo de regresión en lógica ya compleja y probada por el uso real. Con este incremento, SEC-01 queda **resuelto**: las ~24 rutas con body JSON del cliente fueron revisadas una por una.
- 2026-07-12 (OPS-01, segundo incremento — **cierra el ticket**): hallazgo real más importante: `src/lib/content-publish.ts` (usada tanto por el cron de auto-publicación como por "Publicar ahora") atrapaba el fallo de publicar en Instagram/Google Business con un `catch { result.instagram = "error" }` **completamente vacío** — sin ningún rastro de la causa real (token vencido, rate limit, imagen faltante, error de la API). Se agregó `console.error` con item id, canal y mensaje real (nunca tokens). Mismo criterio aplicado a `instagram-business/publish` y a las 6 rutas de `google-business/{profile,posts,posts/[postId],reviews,reviews/[reviewId]/reply,locations}` que devolvían el error al cliente sin loguearlo. **Se investigó y no hizo falta tocar nada**: los fallos de IA (Gemini/Claude) ya quedan registrados de forma durable en la tabla `ai_requests` (`logRequest()` en `ai.ts`, con `success`/`error_message`) desde antes de esta sesión — mejor que un `console.error` porque persiste en la base. Con esto, OPS-01 queda **resuelto**.
- 2026-07-12 (PERF-01, segundo incremento — **cierra el ticket**): `/leads` ya no trae un tope fijo de 300 filas sin forma de ver más atrás — pagina de verdad (`select("*", { count: "exact" })` + `.range()`, 50 por página) con controles "Anterior/Siguiente" que preservan los filtros activos en la URL. **Bug real encontrado en `/api/leads/export`, más allá de "sin límite"**: PostgREST (la API REST de Supabase) aplica su propio tope de filas por respuesta (`db-max-rows`, 1000 por default) que un `select("*")` sin `.range()` respeta en silencio — si los leads superaran ese número, la exportación se truncaba sin ningún aviso, mismo patrón de "conteo subestimado en silencio" ya corregido antes para el dashboard. Corregido paginando con `.range()` en un loop hasta agotar los resultados. No se pudo verificar visualmente `/leads` (sin credenciales de login en este entorno) — validado por revisión de código, tests nuevos y build/tests. Con esto, PERF-01 queda **resuelto**.
- 2026-07-12 (TECH-01, segundo incremento — **cierra el ticket**): agregados en `next.config.mjs` (`headers()`) `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` y un `Permissions-Policy` que solo deniega `camera`/`microphone`/`geolocation` (verificado que no se usan). **Decisión deliberada**: a propósito no se agregó Content-Security-Policy — es la parte que puede romper en silencio el OAuth de Google/Instagram, Google Analytics, fotos de Google Places o imágenes de Supabase Storage, y armarlo bien requiere probar cada integración de punta a punta (sin credenciales de login en este entorno, no se puede). Los 4 headers elegidos no son un allowlist de dominios — no interactúan con OAuth/scripts/conexiones — y se verificaron visualmente con un dev server real (`/`, `/dra-lucia-chahin`, `/login`): headers presentes, CSS/diseño idénticos a antes. Con esto, TECH-01 queda **resuelto** (un CSP completo queda como trabajo futuro explícito, con acceso para probar OAuth).
- 2026-07-12 (QA-01, tercer incremento — **cierra el ticket**): tests de integración para los dos callbacks de OAuth (`google-business/callback`, `instagram-business/callback`) — cierra el círculo con el logging de OPS-01. Cubre: sin sesión redirige a `/login`; sin `code`/con `error` redirige con el código correcto; `state` que no coincide redirige con `error=oauth_state`; **una falla real en el intercambio de tokens loguea con `console.error` (verificado en el test) y redirige con `error=token_exchange`**; un intercambio exitoso guarda los tokens y redirige con éxito. El patrón ya cubre 6 rutas distintas (webhook de WhatsApp, 3 rutas de leads, cron, y ahora los 2 callbacks de OAuth). Con esto, QA-01 queda **resuelto**.
- 2026-07-12 (DATA-02, plazos de retención definidos e implementados): Seba definió la política — leads que nunca se convirtieron en pacientes o con solo datos administrativos se anonimizan/eliminan tras 24 meses de inactividad (reusa `erase_lead()`, ver `src/lib/data-retention.ts` → `runDataRetentionSweep()`); datos de protocolo de investigación clínica (`protocol_interest`/`protocol_name`/`status=elegible_protocolo`) **nunca se borran automáticamente** (plazo legal mínimo 10 años) — en su lugar, tras 24 meses de inactividad se bloquea el uso comercial (`consent_to_contact=false` + nueva columna `retention_hold`, migración `20260712_data_retention.sql`, ya corrida en producción) sin tocar el dato, visible como "🔒 En resguardo legal" en `/leads/[id]`. La clasificación clínica/protocolo es una función pura con tests (`isClinicalOrProtocolLead`), única fuente de verdad del criterio. La barrida corre semanalmente dentro del cron de `weekly-report` (no suma un cron nuevo, mismo patrón que `whatsapp-followup`). Además, nueva detección determinista de baja de marketing (`isMarketingOptOutMessage` en `whatsapp-intents.ts`: "BAJA"/"STOP"/frases explícitas) que corta el bot y pone `consent_to_contact=false` al instante, sin esperar la barrida semanal — chequeada antes que cualquier otra lógica de estado del bot. Como el proyecto arrancó el 2026-06-11, hoy no hay ningún lead con 24 meses de inactividad real — el umbral no tiene efecto práctico hasta mediados de 2028, dando margen para revisar el criterio antes de que borre algo real. Con esto, DATA-02 queda **resuelto**.
- 2026-07-12 (GROWTH-01, atribución de conversión de punta a punta): WhatsApp no manda ningún dato del origen de un click al webhook — Seba confirmó agregar una referencia corta y visible al final del mensaje prellenado (`Ref: LAN-CARD-01`, formato sede+especialidad+secuencia, sin datos personales). `src/lib/landing-referral-codes.ts` (nuevo, con tests) es el registro código↔landing/sede/especialidad; `withReferralCode()`/`extractReferralCode()` arman y detectan la referencia. En `whatsapp-bot.ts`, el código se extrae del primer mensaje y se guarda en la sesión (`whatsapp_sessions.referral_code`, columna nueva) hasta que el lead se crea de verdad, momento en que se copia a `leads.utm_content`/`leads.landing_page` (columnas ya existentes). **Bug real encontrado y corregido verificando esto en vivo antes de mergear**: Swiss Medical Lomas usa su propio WhatsApp ("Swity", número distinto al del bot) — un mensaje ahí nunca llega a nuestro webhook, así que agregar una referencia hubiera sido inútil y hubiera ensuciado el mensaje que ve esa recepción. Se agregó `resolvesToBotNumber()` en `public-landings.ts` (con tests) que compara el número resuelto contra el del bot, no solo si hay un override cargado. Nuevo panel en `/dashboard`: "Embudo de atribución por landing/sede" (visita → clic WhatsApp → lead → turno confirmado, RPC `landing_referral_events` para eventos, JS para leads dado el tamaño chico de esa tabla). Verificado en vivo contra un build de producción que el código se agrega/omite correctamente según el número de destino; no se pudo probar un mensaje real entrante ni ver el panel del dashboard (sin credenciales de login) — validado por revisión de código y tests unitarios de cada función pura.
- 2026-07-11 (DATA-02 de `docs/BACKLOG.md`): botón **"Eliminar datos de este paciente"** en `/leads/[id]` (confirmación explícita, irreversible) → `POST /api/leads/[id]/erase` → `eraseLead()` (`src/lib/data-erasure.ts`) → RPC `erase_lead` (migración `20260711_data_erasure.sql`), todo en una transacción SQL: borra `messages`/`handoff_events` del lead (tienen texto/resumen identificable), anonimiza `wa_id` en `whatsapp_cost_events`/`consent_records` (no se puede dejar null, son `not null` — preserva la fila para no perder agregados de costo/consentimiento históricos), borra la sesión de WhatsApp de ese teléfono (solo si no pertenece a otro lead — `leads.phone` no es unique) y la fila de `leads`, y deja registro en `data_erasure_log` (quién/cuándo, sin PII). Se eliminó de paso el `DELETE /api/leads/[id]` genérico que ya existía: no tenía ningún llamador y no limpiaba las tablas relacionadas — quedaba código muerto con riesgo real de borrado incompleto. **Sigue pendiente**: definir plazos de retención automática por tipo de dato (decisión de política, no técnica) — hoy el borrado es siempre manual, bajo pedido.
- 2026-07-11 (TECH-01 de `docs/BACKLOG.md`): `src/middleware.ts` renombrado a `src/proxy.ts` (convención de Next.js 16 — función `middleware()` → `proxy()`). **Corrección importante sobre la guía inicial**: la skill `vercel:nextjs` sugiere `export const proxyConfig` para el matcher, pero eso es **incorrecto para Next.js 16.2.9** — el export del matcher sigue llamándose literalmente `config` (verificado leyendo `node_modules/next/dist/build/analysis/get-page-static-info.js`, que busca ese identificador exacto incluso dentro de `proxy.ts`; solo el nombre de la función exportada cambia). Usar `proxyConfig` hace que el matcher no se reconozca — el proxy corre sin filtro sobre *todas* las rutas, incluidos los assets de `_next/static`, rompiendo el CSS de todo el sitio (redirect 307 a `/login` en cada request de CSS/JS). Esto se detectó recién al verificar visualmente con un screenshot real del dev server (no alcanzaba con `npm run build`/`npm test`, que no lo detectan) — quedó corregido en el mismo PR antes de mergear. De paso se corrigió otro bug real: `isPublicRoute` comparaba el pathname completo contra `PUBLIC_ROOT_PATHS` con match exacto, así que un archivo de metadata anidado bajo una landing (ej. `/cardiologa-lanus/opengraph-image`) no matcheaba y redirigía a `/login` sin sesión — ahora compara contra el primer segmento del path. `npm run lint` quedó en 0 problemas (se sacó un import de tipo sin usar, `ContentChannel`). Se re-chequeó la vulnerabilidad moderada de PostCSS (transitiva de `next`) — sigue sin solución real, no existe ningún `16.3.0` estable todavía. **Queda pendiente** la parte de headers de seguridad (CSP, etc.) que también pedía este ticket — no se tocó por el riesgo real de romper un flujo de OAuth en silencio sin poder probarlo de punta a punta en este entorno (sin credenciales de login).
- 2026-07-11 (SEO-01 de `docs/BACKLOG.md`): nueva landing `/cardiologa-caba` para Hospital Británico (mismo patrón data-driven que las 6 existentes, `src/lib/public-landings.ts`), cross-linkeada en `RELATED_LANDING_SLUGS`. Se agregó imagen Open Graph dinámica (`src/app/[slug]/opengraph-image.tsx`, `next/og`) — antes ninguna landing tenía OG image. **No se reusó `lucia-chahin.jpg`** para la placa: tiene relleno negro en las esquinas pensado solo para uso circular (`rounded-full`), se hubiera visto roto en un preview rectangular de WhatsApp/Instagram — se generó una placa con el nombre + `h1` de cada landing en su lugar. `robots.ts` dejó de tener la lista de slugs hardcodeada (ahora deriva de `PUBLIC_LANDING_SLUGS`, igual que `sitemap.ts` y `proxy.ts`) para que agregar una landing nueva no vuelva a requerir tocarlo a mano. **Bug real corregido de paso**: `buildSubpageFaq()` tenía un ternario binario hardcodeado (CIMEL/Swiss) para la pregunta "¿atendés en otra sede?" — con una tercera sede real hubiera respondido mal; se generalizó calculando "las otras sedes" desde la landing principal. **Otro bug real, preexistente (no de hoy)**: `/sitemap.xml` y `/robots.txt` quedaban atrapados por el auth gate de `proxy.ts` (mismo problema de match exacto que el de `opengraph-image` en TECH-01) y redirigían a `/login` — probablemente la razón real por la que "verificar indexación en Search Console" seguía pendiente en el backlog. Corregido agregando ambas rutas a `isPublicRoute`.
- 2026-07-12 (fix 911→107 + cambio de política de merge): `medical-safety.ts` decía "911" en
  `EMERGENCY_REPLY` mientras el resto del sitio ya decía 107 (SAME) — Seba confirmó explícitamente
  "107 en todos lados". Como tocaba lógica médica, se pausó y se esperó su "dale" antes de mergear
  (PR #61), siguiendo la regla vigente hasta ese momento. Inmediatamente después, Seba pidió sacar
  esa excepción por completo: a partir de ahora los cambios a lógica médica se auto-mergean igual
  que todo lo demás, sin esperar confirmación — la regla y las tres secciones que la mencionaban
  (Reglas obligatorias, Preferencias de interacción, Instrucciones específicas para Claude Code)
  quedaron actualizadas más abajo en este mismo archivo. Sigue siendo la categoría de mayor riesgo
  directo sobre una persona real, así que verificarla con más cuidado antes de mergear, aunque ya
  no haya pausa humana después.
- 2026-07-11 (Ola 0 de `docs/BACKLOG.md`, blindaje de WhatsApp): **`WHATSAPP_APP_SECRET` ahora es fail-closed, no fail-open** — si esa variable no está cargada, `isValidWhatsAppSignature()` rechaza todo POST entrante al webhook (antes dejaba pasar sin validar para no cortar el bot de un día para el otro). Confirmado que la variable ya está cargada en Vercel (activa desde la auditoría de seguridad del 2026-07-07), así que este cambio no corta nada en producción hoy — pero si alguna vez se borra esa env var, el bot deja de recibir mensajes por completo en vez de aceptarlos sin verificar. Hay un aviso crítico en `/dashboard` (`checkWhatsAppWebhookSignatureMissing`) por si eso pasa. Además, el webhook ahora es **idempotente por `wa_message_id`** (tabla `whatsapp_webhook_events`, migración `20260711_whatsapp_webhook_idempotency.sql`, lógica en `src/lib/whatsapp-idempotency.ts`): un reenvío de Meta del mismo evento ya no duplica mensajes, respuestas del bot ni eventos de costo. Y **ya no devuelve `200` incondicional**: si el procesamiento de un mensaje falla de forma transitoria, el webhook responde `500` para que Meta reintente la entrega completa (la idempotencia hace que ese reintento sea seguro); si falla de forma definitiva (`WindowClosedError`, `TemplateNotApprovedError` — van a volver a fallar igual), sigue respondiendo `200` pero manda una alerta por email (reusa `sendCronFailureAlert`, mismo mecanismo que los cron jobs). Detalle completo en `docs/BACKLOG.md` → "Ola 0".
- 2026-07-13 (métricas más allá del bot de WhatsApp): Seba marcó que el dashboard parecía medir
  solo contactos por el bot de Lucía, dejando afuera pacientes que llaman/escriben directo a Swiss
  Medical o al Hospital Británico (ninguna de las dos sedes pasa por el bot: Swiss usa su propio
  WhatsApp "Swity", Británico deriva a teléfono/central de turnos) y el crecimiento de seguidores de
  Instagram. Investigado a fondo: las visitas de landing y los clicks por sede **ya se capturaban**
  en `landing_events` (`click_call`/`click_whatsapp` + `location_key` desde el 2026-07-06), pero no
  se veían en ningún lado — la card "Métricas de landings" del dashboard medía `cta_cimel`/
  `cta_swiss`/`cta_britanico`/`form_submitted`, tipos de evento que **ningún componente dispara desde
  ese mismo rediseño**: mostraba 0/0/0/0 permanentemente, una métrica muerta que aparentaba medir
  algo. Se reemplazó por una card real, "Clicks por sede: llamada y WhatsApp" (RPC
  `landing_clicks_by_location`, migración `20260713_landing_clicks_by_location.sql`), que sí cubre
  Swiss y Británico — deja explícito que mide el click, no si ese contacto externo (invisible para la
  app) terminó en un turno. Para Instagram, no existía ningún tracking histórico de seguidores —
  `getBusinessDiscovery()` (para consultar OTRAS cuentas) está confirmado que no funciona en
  `graph.instagram.com`, pero el conteo de la **cuenta propia conectada** es un campo normal
  (`/me?fields=followers_count`, ya alcanza con el scope `instagram_business_manage_insights`
  cargado desde el 2026-07-10) que no tiene esa limitación. Se agregó `getFollowerCount()`
  (`src/lib/instagram-business.ts`) y un snapshot diario (`src/lib/instagram-followers.ts`, tabla
  `instagram_follower_snapshots`, migración `20260713_instagram_follower_snapshots.sql`) que corre
  dentro del cron ya existente de `publish-content` (no suma un cron job nuevo). Nueva card
  "Instagram: seguidores" en `/dashboard` con el total actual y la variación de 7/30 días. **No
  verificado contra la API real de Instagram en este entorno** (sin credenciales de Meta ni de
  Supabase acá) — si `followers_count` resultara no estar disponible para esta cuenta/token, el
  snapshot falla en silencio hacia el cron (no lo rompe) y queda logueado como el resto de fallos de
  publicación (ver OPS-01); revisar el resultado real de la primera corrida en producción.
- 2026-07-13 (mismo día, continuación): las 2 migraciones de arriba quedaron sin aplicar en
  producción (el entorno del celular no tiene `SUPABASE_DB_PASSWORD`) — corridas después desde la
  notebook, `npm run migrate` las aplicó sin problema. Con la card ya mostrando datos reales, Seba
  marcó que los números eran sospechosamente bajos: "Llamar" daba **0 en las tres sedes** y
  WhatsApp daba apenas 1 en Swiss y 1 en Británico — "es imposible que solo haya sido 1 persona".
  **Bug real encontrado**: `trackLandingEvent()` (`src/lib/landing-track.ts`) mandaba el evento con
  un `fetch()` sin `keepalive`. El botón "Llamar" navega en la **misma pestaña** (`href="tel:..."`,
  sin `target="_blank"`) y los de WhatsApp/Maps pueden pausar la pestaña de origen al abrir la app
  nativa en mobile — en ambos casos el navegador puede cancelar un `fetch` en vuelo si la página se
  descarga/pausa antes de que el request salga, más probable todavía en conexión mobile. Esto
  explica el patrón: "Llamar" en 0 por igual en las tres sedes no era casualidad, era sistemático.
  Corregido con `keepalive: true` (fix de una línea, el estándar del navegador para este patrón
  exacto de beacon-antes-de-navegar). **Aclaración importante que no es un bug**: este contador solo
  mide clicks en el botón de la landing — un paciente que consigue el WhatsApp de Swiss o el
  teléfono del Británico por otro canal (Google Maps, Instagram, de memoria) y nunca pasa por la
  landing sigue siendo invisible para la app, ya aclarado en el subtítulo de la card. No se pudo
  verificar en vivo que el fix sube los números reales (sin credenciales de login en este entorno)
  — seguir el número de "Llamar" en los próximos días en `/dashboard`, debería dejar de ser 0.
- 2026-07-13 (mismo día, reorganización del dashboard): a pedido de Seba de mejorar la
  visualización del dashboard de forma integral (no solo Instagram), se reorganizó
  `/dashboard` en secciones con encabezado ("Pacientes y leads", "Sitio web y landings",
  "WhatsApp", "Instagram", "Reportes") en vez de una lista larga de cards sin agrupar. Se
  sumaron dos cosas nuevas, ambas reusando datos que ya se calculaban en algún lado pero
  nunca se mostraban juntos: **"Visitas al sitio"** como quinto KPI en la fila principal
  (suma de `landingRanking.rows`, la cifra ya existía desglosada por landing en "Ranking de
  landings" pero no había un total consolidado a simple vista) y **"Costo de WhatsApp"**
  (7d/30d, con link a `/costos` para el detalle) — antes el costo era completamente invisible
  desde el dashboard principal, solo vivía en `/costos`. Nueva función compartida
  `getWhatsAppCostSummary()` en `src/lib/whatsapp-cost-tracking.ts` (misma lógica de suma que
  `/costos`, para no arriesgar que los dos números diverjan con el tiempo) — `/costos` en sí
  no se tocó. **Evaluado y descartado explícitamente, no por falta de esfuerzo**: insights por
  post de Instagram (reach/likes/comments) — el `mediaId` que devuelve `publishContainer()` no
  se persiste en ninguna tabla hoy, así que no hay forma de pedir `/insights` de un post
  después de publicado sin agregar antes esa persistencia (cambio de esquema, no solo de UI);
  tendencia de rating de Google Business — bloqueado por la cuota 0 de la GBP API (ver
  `docs/BACKLOG.md`, caso de soporte en trámite), construir un snapshot que dependa de una API
  sin acceso hoy fallaría en silencio para siempre hasta que se resuelva la cuota. Ambos quedan
  como ideas concretas para retomar, no implementadas. No se pudo verificar visualmente en este
  entorno (sin credenciales de login) — validado por build, lint y tests.
- 2026-07-13 (dashboard de crecimiento multicanal): la revisión anterior quedó superada para las
  métricas de **cuenta**. `/dashboard` ahora tiene selector 7/30/90/365 días, comparación contra el
  período anterior, serie diaria y embudo visita → acción → lead → turno, tabla de canales, desglose
  de acciones web y visualizaciones históricas de Instagram/Google. La migración
  `20260713_dashboard_growth_metrics.sql` agrega `landing_events.session_id` (UUID anónimo por
  pestaña en `sessionStorage`, sin cookie ni PII) y RPCs agregadas; así una persona que toca varios
  botones cuenta una sola vez como visita con acción. Se agregaron enlaces públicos estables
  `https://draluciachahin.ar/go/instagram` y `/go/google`: redirigen a la landing con UTMs propias y
  se muestran listos para copiar en "Bio y Fijados" y "Google Local". Instagram guarda diariamente
  `reach`, `profile_views`, `profile_links_taps` y `total_interactions` junto al snapshot de
  seguidores. Google guarda rating/reseñas desde Places API y, cuando Google habilite la cuota,
  impresiones/clicks/llamadas/direcciones desde Business Profile Performance API; una respuesta de
  cuota 0 queda como `quota_blocked` (estado visible, no falsa alarma diaria). Todo corre dentro de
  `publish-content`: `vercel.json` sigue con exactamente 2 crons. Los insights nativos **por post**
  de Instagram siguen pendientes porque todavía no se persiste el `mediaId`; el dashboard sí muestra
  qué piezas llevaron visitas/acciones a la web mediante el link `utm_content` ya existente. La UI
  se verificó localmente en escritorio (1440 px) y móvil (390 px) con navegador real; los únicos
  errores de consola fueron reconexiones HMR del servidor de desarrollo, no errores de la app.
- 2026-07-14 (claridad de atribución): la tabla de canales normaliza `ig`/`insta`/`instagram` antes
  de agregar datos, tanto en SQL como defensivamente en la lectura del dashboard; ya no aparecen
  filas separadas para el mismo canal y las tasas se recalculan sobre el total combinado. El panel
  de referencias dejó de repetir las visitas de una landing en cada CTA de sede: ahora muestra una
  tarjeta por landing con visitas únicas y totales, seguida del desglose clic → lead → turno por
  sede/código. `landing_referral_events` también cuenta sesiones únicas para que una recarga o varios
  clics de la misma pestaña no inflen el embudo. Migración `20260714_dashboard_attribution_clarity.sql`.
  Verificado con datos reales en navegador a 1440 px y 390 px; solo hubo errores HMR de desarrollo.
- 2026-07-14 (revisión del dashboard multicanal de Codex, PR #73): Seba pidió revisar lo que Codex
  armó en las sesiones anteriores (PRs #70/#71/#72, corridas en su máquina con acceso real al
  navegador — por eso pudieron verificarse visualmente, algo que estas sesiones en la nube no pueden
  hacer sin credenciales de login) y mejorarlo. Se encontraron y corrigieron 2 bugs reales: (1) el
  texto de "Reportes semanales" seguía diciendo "todos los lunes" — el cron corre los **domingos**
  desde el 2026-07-07 (commit `aadb8c3`, que corrigió `vercel.json`/este archivo/`BACKLOG.md` pero
  no ese texto de la UI, un desprolijo que quedó dando vueltas 7 días); (2)
  `snapshotGoogleBusinessMetrics()` (código nuevo del dashboard multicanal) llamaba a
  `getValidToken()` sin el `.catch(() => null)` que ya usa `/api/google-business/status` — en modo
  Prueba de Google el refresh token vence cada ~7 días y `getValidToken()` rechaza en vez de
  devolver `null`, así que ese vencimiento esperado (limitación de Google ya documentada) se colaba
  como `status="error"` y mandaba una alerta de cron por email todos los días hasta reconectar a
  mano. Corregido con el mismo criterio ya establecido en el resto del código. Además, ícono de la
  sección "WhatsApp" del dashboard (`DollarSign` → `MessageSquare`, consistente con `CHANNEL_META`/
  `ACTION_META`). El resto del dashboard multicanal de Codex (selector de período, embudo, tabla de
  canales, enlaces `/go/instagram`/`/go/google`, snapshots de Instagram/Google) se revisó a fondo
  (SQL de las migraciones, RPCs, límites de fechas, agregaciones) sin encontrar errores adicionales.
  npm test (307/307), lint y build sin errores. No se pudo verificar visualmente (sin credenciales
  de login en este entorno).
- 2026-07-14 (misma sesión, PR #75 — verificación visual real por primera vez): Seba pidió arreglar
  la limitación de arriba ("conectate a lo que tengas que conectarte") para poder trabajar a la par
  de Codex. Esta sesión de Claude Code sí corre local en la máquina de Seba (VS Code, con
  `.env.local` real) — la diferencia con sesiones anteriores no era el entorno sino no haber armado
  todavía el login automatizado. Con aprobación explícita de Seba: se creó un usuario de prueba
  dedicado en Supabase Auth (`e2e-agent-test@lule-internal.local`, aislado de leads/pacientes) vía
  Admin API, y se usó `e2e/authenticated/auth.setup.ts` (ya escrito para QA-02) + Playwright para
  loguearse y sacar capturas reales de `/dashboard` — primera vez que un agente ve el dashboard con
  datos reales en vez de solo leer el código. **Recomendación para Seba**: si querés que esto quede
  permanente (para mí y para Codex, sin tener que crear el usuario de nuevo cada vez), agregá a tu
  `.env.local` las líneas `E2E_TEST_EMAIL=e2e-agent-test@lule-internal.local` y
  `E2E_TEST_PASSWORD=` (contraseña que se generó y mostró en el chat de esa sesión) — nunca lo hice
  yo mismo porque `.env.local` está en la lista de archivos que ningún agente puede tocar. Con eso
  cargado, `npm run test:e2e` deja de saltar los tests autenticados (QA-02 pasa de parcial a poder
  correrse de verdad) y cualquier sesión futura puede volver a loguearse sin pedir aprobación de
  nuevo. Mirando el dashboard real se encontraron y corrigieron 2 problemas más (mismo PR): (1)
  **local y producción comparten la misma base de Supabase** (no hay proyecto de staging) — cualquier
  sesión de agente o corrida de `npm run test:e2e:public` contra `localhost` grababa visitas reales
  en `landing_events` de producción (confirmado con una consulta de solo lectura aprobada por Seba:
  page_views a las 2-4am ART y picos de 66 visitas/día no encajan con tráfico de pacientes reales de
  un consultorio recién lanzado). `trackLandingEvent()` ahora no manda nada si el hostname es
  `localhost`/`127.0.0.1` — no toca el tracking de producción ni de previews de Vercel. (2) La card
  de Google Business no mostraba ningún aviso cuando todavía no hay snapshots guardados (quedaba en
  blanco con guiones), a diferencia de la de Instagram que sí lo maneja — mismo mensaje agregado.
  **Aclaración, no bug**: el `session_id` para deduplicar visitas está en `null` en casi todos los
  eventos históricos hasta esta fecha — es el fallback ya documentado en la migración (cuenta cada
  fila como visita, sin romper nada), no algo nuevo para arreglar; los números de "visitas únicas"
  de antes del 2026-07-14 son en la práctica conteo de filas, debería autocorregirse con tráfico
  nuevo. npm test (310/310), lint y build sin errores.
- 2026-07-14 (bug real: responder manual desde el Inbox no llegaba al paciente): Seba reportó que,
  tras una derivación fallida del bot (el paciente quedó sin poder pedir turno), le escribió una
  disculpa a mano desde `/inbox` y no funcionó. **Causa real**: `POST /api/messages` (usado por el
  cuadro de texto del Inbox) nunca llamaba a la API de WhatsApp — solo insertaba el texto en la
  tabla `messages` local, y encima con `role: "user"` (como si el mensaje lo hubiera escrito el
  *paciente*, no el equipo). Como el checkbox "IA" viene tildado por defecto, encima disparaba
  `generateReply()` tratando ese texto de Seba como si fuera el mensaje entrante del paciente,
  generando una respuesta del bot confundida — visible en la captura que compartió, y que tampoco
  se mandaba a ningún lado. Ningún mensaje salía nunca del navegador. Corregido en
  `src/app/api/messages/route.ts`: si el lead tiene teléfono y `origin_channel === "whatsapp"`
  (o sea, viene de una conversación real del bot), el texto ahora se manda de verdad con
  `sendText()` (misma función que usa el bot, ver `src/lib/whatsapp.ts`) — respeta la ventana de
  24h (si está cerrada, devuelve 409 con un mensaje claro en vez de fallar en silencio; todavía no
  se puede elegir un template desde el Inbox para ese caso, queda pendiente) y el mensaje queda
  logueado con `role: "assistant"` (saliente) vía el mismo `logWhatsAppMessage` que usa el bot, sin
  insert duplicado. Para leads sin canal de WhatsApp real conectado (Instagram, manual, etc.) se
  mantuvo el comportamiento anterior (registro interno + sugerencia opcional de IA), pero ahora
  con un aviso explícito en la UI de que ese mensaje no se manda a ningún lado automáticamente — y
  el checkbox "IA" se oculta cuando sí hay envío real, porque ahí no tiene ningún efecto. El
  frontend (`src/app/(app)/inbox/page.tsx`) también dejaba de chequear `res.ok`: un error del
  servidor se ignoraba en silencio y podía empujar `undefined` al historial de mensajes — ahora
  muestra el error con `alert()`. Tests nuevos en `src/app/api/messages/route.test.ts` (envío real,
  ventana cerrada, error de la API, y que el camino sin WhatsApp real sigue igual). npm test
  (315/315), lint y build sin errores. **No se pudo verificar visualmente en este entorno** (sin
  `.env.local`/credenciales de WhatsApp ni de login acá) — seguir de cerca el primer envío manual
  real en producción.
- 2026-07-14 (mismo día, pausar el bot al responder a mano): Seba pidió una forma explícita de que
  el bot no le conteste al paciente mientras el equipo está respondiendo manualmente desde el Inbox
  — hasta ahora, aunque el mensaje manual ya se mandaba de verdad por WhatsApp (punto anterior), el
  bot seguía activo y podía seguir procesando los siguientes mensajes del paciente y respondiendo
  por su cuenta, pisando la conversación manual. Se agregó `whatsapp_sessions.bot_paused` (migración
  `20260714_whatsapp_bot_pause.sql`, default `false`) y un chequeo en
  `handleIncomingMessage` (`src/lib/whatsapp-bot.ts`): si la sesión tiene `bot_paused = true`, el
  mensaje entrante se sigue logueando igual (aparece en el Inbox), pero el bot no dispara ninguna
  respuesta ni derivación automática. **A propósito, el chequeo va después de los guardrails de
  seguridad** (detección de emergencia médica y baja de contacto "BAJA"/"STOP"), no antes — esos dos
  siguen funcionando aunque el bot esté pausado, porque son casos donde no corresponde esperar a que
  el equipo vea el mensaje a mano. Nuevo endpoint `GET/PATCH /api/whatsapp/bot-pause` (por
  `lead_id`, resuelve el teléfono y lee/escribe la sesión con `getServiceDb()` porque
  `whatsapp_sessions` solo tiene policy de escritura para `service_role`). `POST /api/messages`
  ahora pausa el bot automáticamente al mandar un mensaje manual real (no hace falta acordarse de
  tocar un switch aparte para el caso más común), y el Inbox (`src/app/(app)/inbox/page.tsx`) suma
  un botón "Bot activo"/"Bot pausado" en el header de la conversación (solo visible en leads con
  WhatsApp real conectado) para reactivarlo a mano cuando el equipo termina de intervenir. Tests
  nuevos: `src/lib/whatsapp-bot-pause.test.ts` (el flag corta la respuesta normal del bot pero no
  los guardrails de emergencia/opt-out; caso de control sin pausa) y
  `src/app/api/whatsapp/bot-pause/route.test.ts`. npm test (325/325), lint y build sin errores.
  Migración `20260714_whatsapp_bot_pause.sql` sin aplicar todavía en producción (no hay
  `SUPABASE_DB_PASSWORD` en este entorno) — correr `npm run migrate` antes de que esto tenga efecto
  real; hasta entonces, `bot_paused` no existe como columna y el toggle/pausa automática van a
  fallar. **No se pudo verificar visualmente en este entorno.**
- 2026-07-15 (Ola 4 del backlog, cierre completo — sesión local con `.env.local` real): se retomó
  la sesión de emergencia del 2026-07-14 (incidente real con el paciente David Portas). Primero se
  detectó que el clon local había quedado desactualizado (4 commits — PRs #78-81 — solo existían en
  GitHub, ver [[reference_claude_code_web_mobile_access]]); se hizo `git fetch`/`pull`. Se aplicó la
  migración `20260714_whatsapp_bot_pause.sql` pendiente (con aprobación explícita, el harness pide
  nombrar producción cada vez para `npm run migrate`) — la pausa del bot ya tiene efecto real. Se
  implementaron los 4 puntos del plan de corrección: **alerta en tiempo real** por email cuando el
  bot deriva a un humano (`sendHandoffAlert()`, con throttle de 30 min por lead para no saturar en
  conversaciones largas), **recordatorio diario de respaldo** dentro del cron ya existente
  (`runHandoffReminderCheck()`, corre una vez al día por el límite de 2 crons de Vercel Hobby — no
  es un recordatorio fino a los 30-60 min, es una red de seguridad si la alerta puntual se pierde),
  **teléfono/contacto de la sede** como alternativa inmediata en el mensaje de derivación cuando el
  bot ya sabe la sede preferida, y **prioridad visual por tiempo de espera** en Inbox/`/leads`
  (badge rojo "Esperando hace Xh", los leads que requieren humano suben al principio). De paso,
  `resolveHandoffForLead()` hace que el aviso de "Atención" se limpie solo cuando el equipo responde
  de verdad desde el Inbox — antes quedaba marcado para siempre, sin ningún mecanismo que lo sacara.
  **Verificación visual real por segunda vez** (después de la del 2026-07-14): con aprobación
  explícita, se rotó la contraseña del usuario E2E (la anterior no se había guardado) y se usó
  Playwright para loguearse y confirmar con datos reales de producción que la priorización funciona
  (capturas borradas después de revisarlas — contienen PII de un paciente real, nunca se commitean).
  Esa misma verificación permitió **leer la conversación completa del paciente por primera vez**
  (24 mensajes, antes solo se tenía un fragmento de captura) y encontrar 3 problemas reales
  adicionales, no visibles solo con el fragmento (detalle clínico deliberadamente omitido acá —
  ver `docs/BACKLOG.md` → Ola 4 para el resumen sin datos identificables): (1) el mensaje original
  daba una lectura numérica de presión arterial elevada sobre un familiar en vez de usar una de las
  frases fijas del detector de urgencias (`isEmergencyMessage()` en `medical-safety.ts`,
  "presión muy alta") — no activaba nada. Corregido con un patrón que detecta valores de presión
  ≥140 mencionados cerca de la palabra "presión", más la frase "pico de presión"; (2) **el primer
  mensaje con contenido real de toda conversación nueva del bot se perdía para siempre**, no solo
  en este caso: `logWhatsAppMessage()` en `whatsapp-cost-tracking.ts` solo inserta en `messages`
  `if (params.leadId)` (la columna es NOT NULL), y el lead recién se crea *después* de procesar esa
  primera respuesta — corregido insertando ese mensaje retroactivamente en
  `upsertLeadFromIntake()` y `escalateEmergency()` apenas se crea el lead real (no recupera lo ya
  perdido, corta la pérdida hacia adelante); (3) el regex de `hablar_con_humano` era demasiado
  literal — el paciente pidió hablar con una persona cinco veces (variantes como "prefiero una
  persona del equipo" o solo "persona") sin que matcheara nada, hasta acertar la frase exacta —
  ampliado para cubrir "prefiero/quiero/necesito ... persona/humano/alguien" y una palabra suelta.
  Los tres tienen tests con mensajes sintéticos equivalentes (no el texto real del paciente). Con
  el contexto completo, ese caso puntual seguía marcado "requiere humano" 19 horas después aunque
  Lucía ya le había respondido varias veces (el mecanismo de resolución automática recién se agregó
  hoy) — se resolvió a mano con aprobación explícita de Seba, como backfill único, no como acción
  recurrente. `npm test` (344/344), lint y build sin
  errores. Riesgo: toca lógica médica (guardrail de emergencia, ampliado — no reducido) y el flujo
  de creación de leads del bot — verificado con más cuidado antes de mergear por ser la categoría de
  mayor riesgo directo sobre una persona real.
- 2026-07-15 (continuación, mismo día): tres correcciones más en respuesta a preguntas de Seba
  sobre la misma conversación. (1) **Cuarto bug real**: el paciente cerró la conversación
  agradeciendo porque ya había conseguido turno en otro lado ("gracias doc... ya conseguí turno...")
  — como el mensaje contenía la palabra "turno", el clasificador lo tomaba como `pedir_turno` y el
  bot reenviaba el menú de sedes, ignorando que ya no necesitaba nada. Nuevo intent
  `turno_ya_resuelto` (`whatsapp-intents.ts`, chequeado antes que `pedir_turno`), responde con un
  cierre cálido en su lugar. (2) A pedido explícito de Seba, **alerta también por WhatsApp** (además
  del email) cuando el bot deriva a un humano — nuevo template `alerta_interna_derivacion`
  (migración `20260715_internal_alert_template.sql`, aplicada). `ALERT_WHATSAPP_TO` quedó
  configurado como sensible en Vercel Production el 2026-07-16; sigue pendiente la aprobación del
  template en WhatsApp Manager (fail-open: mientras tanto llega solo el email). Tiene costo real
  por mensaje (a diferencia del email),
  aclarado en la documentación. (3) Preguntando por el costo de sumar IA de respaldo al bot, se
  encontró que **Gemini 2.0 Flash** (el modelo default hardcodeado en `ai.ts` cuando `GEMINI_MODEL`
  no está seteado) **fue dado de baja por Google el 1/6/2026** — corregido a `gemini-3.5-flash`
  (vigente, verificado contra la documentación pública de Google). El respaldo de IA del bot
  (`Configuración → Bot de WhatsApp → Proveedor de IA`) sigue en "Sin IA" — es un toggle de un click
  que le queda a Seba (ver `docs/BACKLOG.md`), junto con subir `DAILY_AI_REQUEST_LIMIT` de 20 a 300
  antes de activarlo (env var, no lo puede tocar un agente). Con el tier gratuito actual de Gemini
  (1.500 requests/día), el costo esperado de este respaldo al volumen de esta cuenta es
  prácticamente $0 — el límite que realmente importa es el propio `DAILY_AI_REQUEST_LIMIT`
  (compartido entre contenido + clasificación de leads + este respaldo), no el pricing de Google.
  `npm test` (354/354), lint y build sin errores en las tres correcciones. Además, en el camino se
  encontraron y corrigieron **dos exposiciones de datos reales de este mismo paciente** en contenido
  a punto de pushearse a este repo público (cuerpo de un PR y, más grave, un commit que llegó a
  mergearse a `main` antes de notarlo) — corregidas con un commit de redacción sobre `main` una vez
  detectado. Ver `docs/BACKLOG.md` → Ola 4 para el detalle sin datos identificables.
- 2026-07-15 (mismo día, cierre): Seba cargó `GEMINI_MODEL=gemini-3.5-flash` y
  `DAILY_AI_REQUEST_LIMIT=300` en `.env.local` y en las env vars de producción de Vercel (con
  redeploy), y activó "Proveedor de IA" en Configuración. Al revisar `GEMINI_MODEL` en el dashboard
  de Vercel se encontró que su valor real era una API key (formato `AIzaSy...`), no un nombre de
  modelo — probablemente cargada por error en algún momento sin quedar registrado en el código
  (variable marcada "Sensitive", por eso pasó desapercibida). Corregido a mano por Seba en el
  dashboard. Pidiendo verificar que la IA del bot funciona de verdad, se probó `classifyWhatsAppIntent()`
  en vivo contra la API real de Gemini (script temporal, sin tocar Supabase) y se encontró **un
  segundo bug real, preexistente**: el límite de `maxTokens: 20` hacía que la respuesta siempre
  llegara cortada a mitad del JSON (`finishReason: MAX_TOKENS`) porque el modo JSON de Gemini
  pretty-printea la salida — la clasificación nunca funcionaba de verdad, caía siempre en
  "otro_no_entendido" en silencio. Sin este segundo fix, activar el proveedor de IA no hubiera
  tenido ningún efecto real. Corregido a `maxTokens: 60` (verificado en vivo: la respuesta real más
  larga usó 16 tokens), y confirmado que clasifica bien, incluyendo el intent `turno_ya_resuelto`
  agregado hoy mismo. `npm test` (354/354), lint y build sin errores.

## Qué es esta app
Sistema de adquisición de pacientes para la Dra. Lucía Chahin, cardióloga.
Ayuda a captar leads, clasificarlos con IA, derivarlos al canal correcto (CIMEL Lanús / Hospital Británico / Swiss Medical Lomas)
y hacer seguimiento hasta que el paciente confirme que pidió turno.
**No da turnos, no reserva horarios, no confirma disponibilidad.**

## Reglas obligatorias (todo agente: Claude Code, Codex, cualquier otro)
- **Nunca** modificar `.env`, `.env.local` ni ningún archivo con secrets.
- **Nunca** exponer tokens, API keys, Supabase `service_role`, ni credenciales de Meta,
  Google, Anthropic o Gemini — ni en código, ni en logs, ni en commits, ni en output.
- **Nunca** pushear directo a `main`. Trabajar siempre en rama + Pull Request (Vercel genera
  una URL de preview por PR).
- **Para la tarea de hardening del bot iniciada el 2026-07-16, no hacer commit ni push sin
  autorización explícita de Seba.** Además, los cambios de lógica médica (guardrails, síntomas de
  alarma o texto sobre salud visible al paciente) requieren mostrar el resultado y esperar su
  “dale” antes de mergear/deployar, aunque build/tests pasen. Esta regla vigente reemplaza cualquier
  instrucción histórica de auto-merge sin excepción que aparezca más abajo.
- **"Avisar" en cualquier caso significa informar en el resumen de la tarea, no preguntar ni
  esperar respuesta.** Si el cambio tocó webhooks, cron, RLS/auth o lógica médica, contarlo
  igual de claro en el resumen técnico — pero después de haber mergeado, no antes.
- Priorizar siempre: seguridad, privacidad, Supabase RLS, integridad de los webhooks de
  WhatsApp, y los límites del plan Vercel Hobby (2 cron jobs máximo, ver `vercel.json`).
- Antes de tocar webhooks de WhatsApp: revisar los tests existentes o proponer tests nuevos.
- Antes de tocar cron jobs de Vercel: revisar el impacto en los 2 cron jobs existentes
  (`publish-content`, `weekly-report`).
- Toda mejora de growth/marketing debe mantener un tono médico responsable.
- Todo cambio debe cerrar con: resumen técnico de qué se hizo + lista de archivos modificados.
- Si una tarea implica riesgo legal, de privacidad o de producción (no médico): explicarlo
  claramente en el resumen — pero seguir adelante, sin pausar a esperar aprobación.

Ver también `AGENTS.md` para las instrucciones equivalentes orientadas a Codex.

## Stack
- Next.js 16.2 (App Router) — usar `next.config.mjs`, NO `.ts`
- TypeScript + Tailwind CSS + shadcn/ui (instalado manualmente, sin CLI)
- Supabase (Auth + PostgreSQL) — NO usar generic `createBrowserClient<Database>`
- Google Gemini o Claude mediante `src/lib/ai.ts` para clasificación y generación de contenido. En
  WhatsApp la IA solo clasifica a enums cerrados; las respuestas al paciente salen de un catálogo fijo.
- Vercel (deploy automático desde `main`)

## Node.js en Windows
Node está en `C:\Program Files\nodejs\` y no se carga automáticamente en bash.
Siempre ejecutar via:
```
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm ..."
```

## Estructura de archivos clave
```
src/
├── proxy.ts              # antes middleware.ts (renombrado en Next.js 16, ver TECH-01)
├── app/
│   ├── (app)/           # rutas protegidas
│   │   ├── layout.tsx
│   │   ├── page.tsx     # dashboard
│   │   ├── leads/
│   │   ├── inbox/
│   │   ├── contenido/instagram/
│   │   ├── google-local/
│   │   ├── landings/
│   │   ├── experimentos/
│   │   ├── costos/          # dashboard de costos del bot de WhatsApp
│   │   └── configuracion/
│   ├── (auth)/login/
│   ├── api/
│   └── landings/        # landing pages públicas SEO
├── lib/
│   ├── supabase/
│   ├── ai.ts
│   ├── whatsapp.ts              # envío (Cloud API) + logging de costo + gate de ventana/template
│   ├── whatsapp-bot.ts          # flujo conversacional (máquina de estados)
│   ├── whatsapp-pricing.ts      # motor de precios (whatsapp_pricing_rules)
│   ├── whatsapp-window.ts       # ventana de 24h / Free Entry Point (Click-to-WhatsApp)
│   ├── whatsapp-cost-tracking.ts
│   ├── whatsapp-templates.ts    # templates aprobados por Meta
│   ├── whatsapp-intents.ts      # intents cerrados (reglas primero, IA de respaldo opcional)
│   ├── whatsapp-consent.ts
│   ├── whatsapp-handoff.ts      # resumen + derivación a humano
│   ├── whatsapp-settings.ts     # app_config.whatsapp_settings (modo ahorro, umbrales, flag oct 2026)
│   └── medical-safety.ts        # detección de síntomas de alarma (determinística)
├── types/
│   └── index.ts
└── components/
    └── ui/
```

## Variables de entorno (.env.local — NO commitear)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_PASSWORD=   # Para migraciones: npm run migrate. Ver: Supabase → Project Settings → Database → Password
AI_PROVIDER=auto
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
# Google Business Profile API (OAuth 2.0)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Opcional si el host publico no coincide con la request:
GOOGLE_OAUTH_BASE_URL=https://tu-dominio.com
# Places API (New) — trae reseñas reales de Google Maps para la landing pública
# (sección "Opiniones de pacientes"). Independiente del OAuth de arriba, no vence.
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACE_ID=
# Google Analytics (GA4) — mide visitas/sesiones de las páginas públicas (landing principal +
# landings SEO). NEXT_PUBLIC_ porque se carga en el navegador. Sin esto, no se inyecta ningún script
# (no bloquea nada, mismo patrón honesto que Places API arriba).
NEXT_PUBLIC_GA_MEASUREMENT_ID=
# Instagram API with Instagram Login (publicar posts/historias desde Estudio de contenido)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
# Opcional si el host publico no coincide con la request:
INSTAGRAM_OAUTH_BASE_URL=https://tu-dominio.com
# WhatsApp Business Platform (Cloud API) — bot conversacional
WHATSAPP_PHONE_NUMBER_ID=     # Panel: developers.facebook.com → app → WhatsApp → API Setup
WHATSAPP_ACCESS_TOKEN=        # Token permanente o de sistema (no el temporal de 24h)
WHATSAPP_VERIFY_TOKEN=        # String secreto elegido por vos, para verificar el webhook
WHATSAPP_APP_SECRET=          # App Secret de la app de Meta (Configuración básica → App Secret).
                               # Verifica la firma X-Hub-Signature-256 de cada POST entrante al
                               # webhook, para descartar mensajes forjados por alguien que
                               # descubra la URL. Sin esto seteado, el webhook rechaza los POST
                               # entrantes (fail-closed).
META_GRAPH_API_VERSION=       # Versión explícita de Graph API. Se acepta temporalmente el alias
                               # legacy WHATSAPP_GRAPH_API_VERSION; no depender del default.
# Cron jobs de Vercel (publicacion automatica de contenido + reporte semanal). Mismo secreto para ambos.
CRON_SECRET=                  # String secreto elegido por vos. Sin esto seteado, los crons fallan-cerrado (401) y no corren nada
# Alerta por email si falla un cron (publish-content o weekly-report) — ver "Alertas de cron por email"
RESEND_API_KEY=                # API key de resend.com. Sin esto, no se manda ninguna alerta (fail-open, no bloquea el cron)
ALERT_EMAIL_TO=                # Email que recibe la alerta (ej. el tuyo)
ALERT_EMAIL_FROM=               # Opcional. Sin esto usa "onboarding@resend.dev" (funciona sin verificar dominio propio)
# Alerta por WhatsApp (además del email) cuando el bot deriva una conversación a una persona --
# ver "Alertas de cron por email" abajo, sección "Alerta también por WhatsApp"
ALERT_WHATSAPP_TO=              # Tu número en formato wa.me (ej. 5491100000000). Sin esto, solo se manda el email
```

## Optimización de tokens / costos de IA
- `src/lib/ai.ts` ya cachea outputs exactos por hash de prompt en la tabla `ai_outputs` (evita repetir la llamada si el input es idéntico).
- Además usa **prompt caching nativo de Anthropic** (`cache_control: { type: "ephemeral" }`) para los system prompts que no dependen del request (instrucciones fijas tipo `SYSTEM_PROMPT`, reglas de imagen, reglas de captación). Esto se activa con la opción `cacheSystem: true` en `generateText`/`generateWithAnthropic`.
- **Regla al agregar una función nueva en `ai.ts`**: si el `system` que le pasás es 100% estático (no interpola `leadContext`, `topic`, etc. dentro del `system`), agregá `cacheSystem: true`. Si el system tiene contenido dinámico, movelo a `messages` en vez del `system` para poder cachear igual.
- No agregar SDKs/wrappers externos de terceros para esto: `@anthropic-ai/sdk` ya soporta `cache_control` de forma nativa.
- **Privacidad**: cualquier propósito que pueda incluir contexto de pacientes o WhatsApp usa
  `cacheMode: "none"`; no guardar prompts ni outputs identificables en `ai_outputs`.

### Bot de WhatsApp con IA de respaldo — costo esperado (2026-07-15)

`Configuración → Bot de WhatsApp → Proveedor de IA` deja elegir "Gemini" como respaldo de
clasificación de intents cuando ninguna regla determinística matchea (`classifyIntent()` en
`whatsapp-intents.ts` — las reglas van siempre primero, la IA nunca reemplaza el texto de las
respuestas, solo elige cuál de las categorías fijas aplica). Análisis de costo al activarlo:

- Tier gratuito de Gemini (modelo `gemini-3.5-flash`, verificado contra ai.google.dev en julio
  2026): **1.500 requests/día, 10 por minuto**. La clasificación de respaldo solo se llama para el
  mensaje que no matchea ninguna regla — una minoría del total — así que al volumen real de esta
  cuenta el costo esperado es prácticamente **$0**, con muchísimo margen por debajo de ese techo.
- El límite que de verdad importa en la práctica es el propio de la app,
  `DAILY_AI_REQUEST_LIMIT` (default 20/día, **compartido** entre generación de contenido +
  clasificación de leads + este respaldo del bot — un solo contador global en `ai_requests`, ver
  `getDailyRequestCount()`). Antes de activar el respaldo del bot, subir ese número (recomendado:
  **300** — dejar margen amplio por debajo del techo real de Google, como red de seguridad ante un
  uso anómalo, sin ser tan alto que dejaría de frenar algo raro). Se cambia en `.env.local` /
  Vercel, no hace falta código.
- Si algún día el volumen superara igual el tier gratuito, el costo pagado de `gemini-3.5-flash` es
  del orden de centésimas de centavo por llamada (mensajes cortos, salida limitada a 20 tokens) —
  no es una preocupación real a la escala de un consultorio.

## Instagram Business — cómo configurar OAuth (publicar posts/historias)
La app usa "Instagram API with Instagram Login" (graph.instagram.com) — NO requiere una Facebook Page vinculada,
solo una cuenta de Instagram profesional (Business o Creator).
1. Ir a https://developers.facebook.com/apps/ → crear app tipo "Business"
2. Agregar el producto "Instagram" → configurar "Instagram Business Login"
3. Scopes requeridos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`
   (este último se agregó 2026-07-10 pensando en habilitar Business Discovery, pero se confirmó que ese
   campo no existe en `graph.instagram.com` — es exclusivo de la Instagram Graph API clásica atada a una
   Facebook Page. `getBusinessDiscovery()` en `src/lib/instagram-business.ts` queda escrito pero no
   funciona con este setup; no consultar datos de otras cuentas de Instagram sin antes resolver esa
   limitación de plataforma)
4. Authorized redirect URIs (OAuth):
   - `http://localhost:3000/api/instagram-business/callback`
   - `https://TU-DOMINIO/api/instagram-business/callback`
5. Copiar Instagram App ID y App Secret a `.env.local` (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`)
6. Aplicar la migracion `20260702_instagram_content_media.sql` (crea el bucket público `content-media` donde se sube la placa antes de publicarla)
7. En la app ir a Estudio de contenido → "Conectar Instagram" → autorizar con la cuenta de Lucía
8. Publicar posts/historias requiere revisión de la app por parte de Meta antes de salir de modo desarrollo (probar primero con la cuenta agregada como tester en el Meta Developer Console)
9. Reels y carruseles con múltiples imágenes no están soportados todavía (la API de publicación necesita video o varias imágenes por slide) — para esos formatos seguí usando "Copiar Instagram" y publicá manualmente

## Google Business Profile — cómo configurar OAuth
1. Ir a https://console.cloud.google.com/ → crear proyecto
2. Habilitar: "My Business Business Information API", "My Business Account Management API", "Business Profile Performance API"
3. OAuth consent screen → External → agregar scope `https://www.googleapis.com/auth/business.manage`
4. Crear credencial OAuth 2.0 Web → Authorized redirect URIs:
   - `http://localhost:3000/api/google-business/callback`
   - `https://TU-DOMINIO/api/google-business/callback`
5. Copiar Client ID y Client Secret a .env.local
6. En la app ir a Google Business → "Conectar con Google Business Profile" → autorizar
7. **Nota**: mientras el OAuth consent screen esté en modo "Prueba" (no verificado), el refresh
   token vence cada ~7 días y hay que repetir el paso 6. La app avisa esto en pantalla
   (`google-local` muestra "Reconectá el perfil de Google" en vez del mensaje genérico).
   Para que no vuelva a pasar, publicar/verificar el OAuth consent screen para el scope
   `business.manage`.

## Reseñas de Google en la landing pública — cómo configurar Places API
La sección "Opiniones de pacientes" de `/dra-lucia-chahin` trae reseñas reales del perfil de
Google de la doctora vía **Places API (New)**, independiente del OAuth de arriba (usa una
API key simple, no vence). Si no está configurada, se muestra el placeholder honesto de siempre.
1. En el mismo proyecto de Google Cloud (o uno nuevo) → habilitar "Places API (New)"
2. Crear una API key restringida a "Places API (New)" (Credentials → Create credentials → API key → Restrict key)
3. Conseguir el **Place ID** del perfil de Google Business de la Dra. Lucía Chahin (no confundir
   con el `google_location_id` que usa la Business Profile API — son sistemas de ID distintos).
   Se puede obtener con el [Place ID Finder de Google](https://developers.google.com/maps/documentation/places/web-service/place-id)
   buscando "Dra. Lucía Chahin" + la dirección de CIMEL Lanús.
4. Copiar ambos a `.env.local` / Vercel: `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`
5. Muestra hasta 5 reseñas (las que Google elige como "más relevantes") sin filtrar por rating —
   los términos de Google Maps Platform prohíben ocultar reseñas para dar una impresión distinta
   a la real. Se cachean 24h (`next: { revalidate: 86400 }` en `src/lib/google-places.ts`).

## Google Analytics — cómo activarlo (2026-07-07)
`src/components/google-analytics.tsx` inyecta el script de GA4 solo en las páginas públicas
(landing principal `/dra-lucia-chahin` y las 6 landings SEO, vía `src/app/landings/[slug]/page.tsx`
que ambas comparten) — no en el CRM interno detrás de login, para no mezclar el uso de Lucía/equipo
con las visitas reales de pacientes.
1. Crear una cuenta y propiedad GA4 en https://analytics.google.com/ para `draluciachahin.ar`
2. Copiar el **Measurement ID** (formato `G-XXXXXXXXXX`, en Administrador → Flujos de datos → tu flujo web)
3. Cargarlo en `.env.local` / Vercel como `NEXT_PUBLIC_GA_MEASUREMENT_ID` y redesplegar
4. Sin esta variable no se inyecta ningún script — no bloquea nada mientras no se cree la cuenta.

## Costos de WhatsApp y templates — cómo completar

El bot de WhatsApp (`src/lib/whatsapp-bot.ts`) usa WhatsApp Business Platform / Cloud API (no la app
común de WhatsApp Business). Meta cobra por mensaje entregado desde el 1/7/2025 y va a empezar a cobrar
también los mensajes `service`/`utility` dentro de la ventana de 24h a partir del **1/10/2026**. El
sistema de costos está preparado para ese cambio, pero **no viene con montos reales cargados**:

1. **Completar los precios reales**: `Configuración → Precios de WhatsApp` lista las reglas de
   `whatsapp_pricing_rules` (categoría, ventana, vigencia). Los montos (`cost_amount`) quedan en blanco
   a propósito — sacálos de WhatsApp Manager → Facturación (varían por cuenta y volumen, Meta no los
   publica en una tabla estática) y cargalos ahí. Sin esto, el dashboard de costos (`/costos`) muestra
   "sin tarifa" en vez de un monto.
2. **Aprobar los 9 templates obligatorios**: `Configuración → Templates de WhatsApp` los lista con texto
   listo para copiar. Enviálos a aprobación real en WhatsApp Manager → Administrador de cuenta →
   Plantillas de mensajes, y una vez que Meta los aprueba, marcá el estado como "Aprobado" en esa misma
   pantalla. **Sin un template aprobado, el bot no puede escribirle a un paciente fuera de la ventana de
   24h** (`sendText`/`sendButtons`/`sendList` lanzan `WindowClosedError` a propósito; usar `sendTemplate`).
3. **Modo ahorro y flag de octubre 2026**: en `Configuración → Bot de WhatsApp` se puede activar
   `cost_saving_mode` (respuestas más compactas, deriva antes a humano) y simular el cobro de octubre
   2026 (`enable_service_message_charging`) antes de que llegue la fecha real, para probar el impacto.
4. **Proveedor de IA del bot**: es independiente del proveedor de IA usado para contenido/Instagram.
   El bot resuelve intents con reglas determinísticas primero (`src/lib/whatsapp-intents.ts`); la IA
   (Gemini/Claude, mismas keys de siempre) solo entra como respaldo opcional si `ai_provider` no es
   "Sin IA". OpenAI / otro LLM / Meta Business Agent aparecen como opciones pero no están implementadas
   todavía (lanzan un error explícito si se seleccionan) — no se agregó esa dependencia sin uso real.

## Publicación automática de contenido — cómo activarla

El Estudio de contenido (`Estudio de contenido → pestaña Biblioteca`) tiene una tarjeta "Publicación
automática" con **dos cronogramas independientes** — Posts de feed e Historias — para que las piezas
aprobadas se publiquen solas cada tantas veces por semana, sin depender de que alguien entre a clickear
"Publicar". Corre vía un **Vercel Cron** diario (`vercel.json`, 11:45 UTC = 08:45 ART, Argentina no tiene
horario de verano) que pega a
`/api/cron/publish-content` y evalúa ambos cronogramas en la misma corrida (cada uno con su propio
enabled/frecuencia/última publicación).

1. **Setear `CRON_SECRET`** en las env vars de Vercel (y en `.env.local` si querés probarlo local) — sin
   esto, el endpoint devuelve 401 y no hace nada (falla-cerrado a propósito).
2. Conectar Instagram y Google Business normalmente (como ya se hacía para publicar a mano).
3. En la tarjeta, activar el track de **Posts** y/o **Historias** por separado, cada uno con su propio
   "veces por semana" (default: posts 2/semana, historias 3/semana — según investigación de cadencia para
   cuentas de salud: no conviene publicar todos los días, baja la calidad y la credibilidad). Los canales
   (Instagram/Google Business) son compartidos, pero Google Business no tiene concepto de "historia", así
   que ese track en la práctica solo publica a Instagram.
3.1. Cada track tiene además un control **"Empezar: Ahora / fecha programada"** (`starts_at`). Si se deja
   en "Ahora" (`null`), el comportamiento es el de siempre: en cuanto se activa, publica la primera pieza
   aprobada en la próxima corrida del cron. Si se elige una fecha futura, el cron no publica nada de ese
   track hasta que llegue esa fecha (aunque esté activado y ya haya piezas aprobadas esperando) — recién
   ahí arranca a contar el intervalo de "veces por semana" desde la primera publicación real.
4. Cada track solo auto-publica piezas `aprobadas` de su propio formato (**post** o **historia** según
   corresponda) — reels y carruseles siguen requiriendo publicación manual (no soportado por la API de
   Meta sin video/multi-imagen).
5. Además del cron, cada card **aprobada** en Biblioteca tiene un botón **"Publicar ahora"** para publicar
   esa pieza al instante en sus canales asignados, sin esperar al cronograma — útil para piezas puntuales
   o para probar que todo funciona.
6. Si algo falla (token vencido, cuenta desconectada, etc.), la pieza queda con un aviso visible en su
   card ("No se pudo publicar en...") y "Publicar ahora" o los botones manuales del editor sirven para
   reintentar. El texto "Último intento: ..." de cada track explica por qué no se publicó nada en la
   corrida más reciente de ese track.
7. **No hay rampa automática de cadencia** (ej. "3x el primer mes, después 2x") — es una decisión de
   diseño a propósito, para no tener estado oculto difícil de razonar. Si se quiere arrancar más agresivo
   el primer mes, subir el número a mano y bajarlo después.
8. **Alerta por email si el cron falla** (2026-07-07) — `/api/cron/publish-content` y
   `/api/cron/weekly-report` mandan un email (vía Resend, ver "Alertas de cron por email" abajo) ante
   una excepción no controlada o un error real (no ante estados esperados como `skipped_*` o
   `quota_exceeded`). Por WhatsApp seguiría requiriendo un template aprobado por Meta, así que se
   resolvió por email en su lugar — sin eso configurado, sigue sin avisar nada y hay que revisar la
   tarjeta de Estudio de contenido o los logs de función en Vercel a mano.

## Alertas de cron por email — cómo activarlas (2026-07-07)

Si `/api/cron/publish-content` o `/api/cron/weekly-report` fallan (excepción no controlada, error real
de Supabase, etc.), `src/lib/alert-email.ts` manda un email vía la API de Resend con el detalle del
error. Es **fail-open a propósito**, mismo patrón que Google Analytics/Places API: sin las env vars
cargadas, no manda nada y no bloquea el cron.
1. Crear una cuenta en [resend.com](https://resend.com) (tiene plan gratis, alcanza de sobra para esto)
2. Copiar la API key a `.env.local` / Vercel como `RESEND_API_KEY`
3. Cargar `ALERT_EMAIL_TO` con el email que tiene que recibir la alerta (ej. el tuyo)
4. Opcional: verificar tu propio dominio en Resend y cargar `ALERT_EMAIL_FROM` con una dirección de ese
   dominio (ej. `Lule Growth OS <alertas@draluciachahin.ar>`). Sin esto, usa
   `onboarding@resend.dev` — funciona igual, sin verificar nada, pero como remitente es genérico de Resend.
5. No hay reintentos ni cola: si Resend está caído en el momento exacto de la falla, se pierde esa
   alerta puntual (no vuelve a intentarse), pero nunca hace fallar al cron por esto.

### Alerta también por WhatsApp cuando el bot deriva a una persona (2026-07-15)

A pedido explícito de Seba (más probable de notarse al toque que un email), la alerta en tiempo
real de `escalateToHuman()` (ver Ola 4 en `docs/BACKLOG.md`) manda **además** un WhatsApp propio,
sin reemplazar el email — si Meta rechaza el template o vos todavía no lo aprobaste, el email sigue
funcionando exactamente igual que antes.
1. El template **`alerta_interna_derivacion`** debe volver a aprobarse en WhatsApp Manager después de
   aplicar `20260715_whatsapp_phase0a_safety.sql`. El texto vigente es genérico y usa una sola
   variable (`CASO-XXXXXXXX`); no envía nombre, motivo ni contenido del paciente. Su estado local
   actual es `pendiente_meta` hasta esa reaprobación.
2. Una vez que Meta lo apruebe, marcalo "Aprobado" en `Configuración → Templates de WhatsApp` (igual
   que el resto).
3. [x] `ALERT_WHATSAPP_TO` ya está cargado como variable sensible de Producción, en formato wa.me.
4. Mientras el template no esté aprobado, no se manda la alerta por WhatsApp — fail-open, no rompe
   ni afecta la alerta por email.
5. **Tiene costo real por mensaje** (a diferencia del email): es un mensaje de negocio iniciado
   fuera de cualquier ventana de conversación, así que siempre usa template y siempre es facturable
   según las reglas de Meta — hoy la tarifa pública para Argentina dio `$0` en las 4 categorías
   (cargado el 2026-07-07 en `Configuración → Precios de WhatsApp`), pero no está garantizado que
   siga así — re-chequear esa tarifa antes de septiembre 2026 (ver
   [[project_whatsapp_pricing_zero_ar]] en memoria).

## Seguimiento automático de leads por WhatsApp — cómo funciona (2026-07-07)

Los leads que quedan sin confirmar turno (`derivado_cimel`/`derivado_swiss`/`derivado_britanico`/
`seguimiento_pendiente` con `followup_due_at` vencido) reciben un reintento de contacto automático
vía WhatsApp, usando el template `recontacto_incompleto` ("¿Te ayudamos a retomarlo?"). La lógica
vive en `src/lib/whatsapp-followup.ts` y corre **dentro del mismo Vercel Cron de `publish-content`**
(no tiene un cron propio en `vercel.json` a propósito, para no sumar un tercer cron job — el plan
Hobby de Vercel limita a 2). También existe `/api/cron/whatsapp-followup` como endpoint standalone
(mismo `CRON_SECRET`) por si querés dispararlo a mano con `curl` para probar el template sin esperar
a la corrida diaria.
- **Requiere que el template `recontacto_incompleto` esté aprobado por Meta** (`Configuración →
  Templates de WhatsApp`, marcarlo "Aprobado" ahí una vez que Meta lo apruebe). Sin eso, la función
  no manda nada y lo reporta en el resultado del cron (`whatsappFollowup.errors`).
- Solo contacta leads con consentimiento específico `appointment_followup`, versión vigente y
  evidencia válida. `consent_to_contact = true` por sí solo no alcanza; además se exige estado
  pendiente y claim atómico. Un resultado ambiguo se cuarentena y escala, no se reenvía a ciegas.
- Usa siempre `sendTemplate`, nunca texto libre — es un mensaje iniciado por el negocio, no una
  respuesta dentro de una conversación activa, así que corresponde template sin importar si la
  ventana de 24h está abierta o cerrada.
- Al enviar, el mensaje queda logueado en el Inbox de ese lead (`messages`), se limpia
  `followup_due_at` y el estado pasa a `seguimiento_pendiente` — igual que hace hoy el botón manual
  "Sugerir mensaje de seguimiento", que sigue existiendo para cuando alguien prefiere revisar y
  mandar el texto a mano en vez de esperar al cron.
- Solo cubre el caso "no confirmó turno". Los otros templates obligatorios
  (`recordatorio_turno`, `seguimiento_post_consulta`, etc.) no se automatizaron porque necesitan una
  fecha de turno real o un momento del journey que esta app no gestiona (no reserva turnos).

## Reportes semanales y link de seguimiento por pieza — cómo funcionan (2026-07-06)

Un segundo **Vercel Cron** (`vercel.json`, domingo 08:00 UTC = 05:00 ART, mismo `CRON_SECRET`) pega a
`/api/cron/weekly-report`: calcula leads nuevos, confirmados, tasa de conversión, canales y
visitas/interacciones de landing de los últimos 7 días, y guarda un snapshot en `weekly_reports`
(un registro por semana, se pisa si se re-corre la misma semana). Se ve en `/dashboard` → "Reportes
semanales" — **no se envía a ningún lado**, es el mismo motivo que el punto 8 de arriba (sin template
de WhatsApp aprobado no hay forma de mandarlo proactivamente).

Cada pieza del Estudio de contenido tiene un **link de seguimiento** (`/api/content/track/[itemId]`,
visible en el editor con botón de copiar) que redirige a `/dra-lucia-chahin` con
`utm_content=<id de la pieza>`. La landing pública ya manda ese `utm_content` en sus eventos de
`landing_events`, así que Biblioteca y el editor muestran cuántas visitas/interacciones generó esa
pieza puntual. **Limitación real de la plataforma**: Instagram no permite links clickeables en posts
de feed comunes — este link solo es útil pegado en historias (link sticker) o en la bio/Linktree, no
hay forma de atribuir un post de feed sin pasar por ahí.

## Sistema de recomendaciones de crecimiento — cómo funciona (2026-07-07)

`/dashboard` → "Recomendaciones de crecimiento" muestra sugerencias automáticas sobre los 4 canales de
adquisición (web/landings, WhatsApp, Instagram, Google Maps), basadas en datos que la app **ya** junta
hoy — no es Machine Learning, es un motor de reglas simples con umbrales fijos
(`src/lib/growth-recommendations.ts`, cada regla es una función pura con sus propios tests). Ejemplos:
"esta landing tuvo muchas visitas pero casi nadie hizo click", "Swiss Medical no tiene obras sociales
cargadas", "hay 3 templates de WhatsApp sin aprobar", "Instagram no publica nada hace 3 semanas", "el
rating de Google bajó". **No hay ninguna acción automática** — cada recomendación es solo informativa,
con un link a la pantalla relevante para que la persona decida. La función que junta los datos
(`getGrowthRecommendationsData` en `dashboard/page.tsx`) está en un try/catch: si falla cualquier query,
la card simplemente no aparece, no rompe el resto del dashboard (mismo patrón que el resto de las
métricas del dashboard). Para agregar una regla nueva: escribir una función pura en
`growth-recommendations.ts` que reciba datos ya fetcheados y devuelva `GrowthRecommendation | null`,
testearla ahí, y sumarla al `Promise.all`/`buildGrowthRecommendations` en el dashboard si necesita un
dato que hoy no se fetchea.

## Tests

El proyecto usa **Jest** (`npm test`) para lógica pura sin UI: pricing, ventana de 24h, intents,
consentimiento, guardrail médico, límites de conversación. Los tests viven junto a cada archivo de
`src/lib/` (`*.test.ts`). No hay tests de UI/E2E todavía.

Desde 2026-07-12 (QA-01) también hay un patrón para **tests de integración de rutas de API**
(`src/app/api/**/route.test.ts`, ver `leads/[id]/route.test.ts`, `leads/export/route.test.ts`,
`cron/weekly-report/route.test.ts`, `webhooks/whatsapp/route.test.ts` como referencia): se importa
`GET`/`POST`/`PATCH` directo del `route.ts` y se llama como una función común, mockeando con
`jest.mock` los módulos de `@/lib/...` que la ruta usa (Supabase, firma del webhook, idempotencia,
el bot, alertas) para no pegarle a la base real ni a Meta. **Requisito**: `jest.config.js` necesita
`moduleNameMapper` para el alias `@/` — sin eso, `jest.mock("@/lib/x")` no resuelve (un `import`
normal sí funciona porque Next lo reescribe en compilación, pero `jest.mock()` recibe un string
literal que Jest debe resolver por su cuenta). Ya está configurado; tenerlo en cuenta si algún día
se toca ese archivo.

### Tests E2E (Playwright) — QA-01/QA-02 (2026-07-12)

`npm run test:e2e` corre **Playwright** contra un server real (no simula el navegador como Jest).
Viven en `e2e/`, separados en dos proyectos.

**Dos bugs reales de infraestructura encontrados y corregidos al sumar esto** (más allá de la
flakiness de `next dev` de abajo):
1. Jest matchea `*.spec.ts` por default — sin excluir `e2e/`, `npm test` intentaba correr los
   specs de Playwright y fallaba con "Playwright Test needs to be invoked via 'npx playwright
   test'". Agregado `<rootDir>/e2e/` a `testPathIgnorePatterns` en `jest.config.js`.
2. El test de `/login` con credenciales inválidas pega a la API real de Supabase Auth (GoTrue) —
   corriéndolo varias veces seguidas en poco tiempo (como se hizo para verificar esto), Supabase
   aplica un throttle anti fuerza-bruta que demora la respuesta bastante más que el timeout
   default de Playwright (5s) — el botón seguía "disabled" (esperando la respuesta) cuando el test
   fallaba por timeout. Ese caso puntual usa un timeout de 20s en vez de bajar la exigencia del
   test.

- **`public`** (`e2e/public/*.spec.ts`): landing principal, las 6 landings SEO, `/login`
  (validación de campos vacíos + error real de Supabase con credenciales inválidas) y que las
  rutas del CRM redirigen a `/login` sin sesión. **No necesitan ninguna credencial** — corren y
  pasan solas. Verificados con `npm run test:e2e:public` contra un build de producción real
  (`npm run build && npm run start`), 18/18 ok.
- **`authenticated`** (`e2e/authenticated/*.spec.ts`): dashboard, crear/editar/buscar un lead,
  abrir una conversación del inbox. Requieren un usuario de prueba dedicado (`E2E_TEST_EMAIL`/
  `E2E_TEST_PASSWORD` en `.env.local` — **nunca la cuenta real de Lucía o de Seba**, crear un
  usuario nuevo en Supabase Auth solo para esto). `e2e/authenticated/auth.setup.ts` hace login una
  vez y guarda la sesión en `e2e/.auth/user.json` (gitignored) para reusarla en el resto de los
  tests de ese proyecto. **Sin esas variables, `auth.setup.ts` se salta solo y todos los tests
  autenticados se reportan como "skipped"** (no como fallidos) — así no rompen un `npm run
  test:e2e` corrido sin el usuario de prueba configurado.
  - **Escritos pero sin verificar corriendo en este entorno** (no hay credenciales de prueba
    disponibles acá) — a diferencia de todo el resto de tests de este proyecto, que sí se
    verificaron pasando de verdad. No dar QA-02 por completamente cerrado hasta que alguien los
    corra con un usuario de prueba real al menos una vez y confirme que pasan.
  - El test de leads crea un lead real con nombre `E2E TEST — ...` y lo borra al final con el
    mismo botón "Eliminar datos de este paciente" de DATA-02 (maneja el `window.confirm()` nativo
    del botón) — si el test se corta a mitad de camino, ese lead de prueba puede quedar sin
    borrar; buscarlo por ese prefijo en `/leads` y borrarlo a mano si pasa.
- **Importante sobre modo dev**: correr `npm run test:e2e` contra `next dev` (Turbopack) con
  varios workers en paralelo puede dar **falsos negativos** — el compilado on-demand de una ruta
  recién visitada bajo carga concurrente tira `SyntaxError: Unexpected end of JSON input` /
  `ECONNRESET` transitorios (confirmado en esta sesión: mismo test, mismo código, 3 fallos contra
  `next dev` con 8 workers, 0 fallos contra `next dev` con `--workers=1`, y 0 fallos contra un
  build de producción real con 8 workers). Para resultados confiables: correr contra
  `npm run build && npm run start` (recomendado, así corre CI), o agregar `--workers=1` si hace
  falta probar contra `next dev`.
- Comandos: `npm run test:e2e` (todo), `npm run test:e2e:public` (solo lo que no necesita sesión),
  `npm run test:e2e:ui` (modo interactivo de Playwright, útil para debuggear un test que falla).
- **CI configurado, pendiente de primera corrida verificada (2026-07-18)**: `.github/workflows/e2e.yml` corre
  `test:e2e:public` en cada PR/push a `main`, y `test:e2e:authenticated` en push a `main`,
  `workflow_dispatch` y una vez al día — deliberadamente no en cada PR, porque esta cuenta de
  prueba comparte la misma base de Supabase que producción (sin staging) y cada corrida
  crea/borra un lead real y ocupa la única sesión activa que admite la cuenta. `login-helper.ts`
  ahora acepta el secreto TOTP también por variable de entorno (`E2E_TEST_TOTP_SECRET`), porque en
  un runner de CI el archivo local `e2e/.auth/totp-secret.json` nunca existe (checkout limpio) y la
  cuenta ya tiene un factor MFA verificado desde corridas locales previas. `npm run
  push-e2e-ci-secrets` (nuevo, `scripts/push-e2e-ci-secrets.mjs`) carga los 6 secrets que el
  workflow necesita leyendo `.env.local`/`e2e/.auth/totp-secret.json` en tu máquina y llamando
  `gh secret set` — ningún agente lee esos valores, correlo vos una vez para que el workflow deje
  de fallar por falta de credenciales.

## Comandos útiles
```bash
# Build
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run build"

# Dev
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run dev"

# Tests (Jest)
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm test"

# Migraciones de Supabase (requiere SUPABASE_DB_PASSWORD en .env.local)
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run migrate"
```

## Preferencias de interacción
- **No pedir confirmación para trabajo local reversible**, pero respetar cualquier restricción
  explícita de la tarea. En el hardening de WhatsApp del 2026-07-16: no hacer commit/push sin
  preguntar, y esperar un “dale” antes de desplegar cambios de lógica médica.
- **Nunca pushear directo a `main`.** Trabajar siempre en rama + Pull Request (la rama+PR es
  para tener preview de Vercel como red de seguridad, no para pedir aprobación humana).
- Para cambios no médicos, seguir `AGENTS.md`. Para cambios médicos, el build/tests/preview son
  necesarios pero no reemplazan la aprobación humana previa al merge/deploy.
- **Solo preguntar cuando hay una decisión real entre múltiples opciones** con consecuencias
  distintas que no se pueden inferir del contexto — no para pedir permiso de ejecutar algo que
  ya se decidió hacer.
- **`npm run migrate` contra producción NO requiere pedir permiso** (actualizado 2026-07-16 a
  pedido explícito de Seba — "no me pidas permiso para hacerlo, hacelo"). Si una migración nueva
  es parte de un cambio que ya se está haciendo (ej. la tarea en curso la generó), aplicarla
  directamente y avisar en el resumen de cierre que se corrió, junto con qué migración fue — no
  preguntar antes ni esperar un "dale". Esto reemplaza cualquier expectativa anterior (ver
  `docs/BACKLOG.md`/memoria histórica) de tratar `npm run migrate` como una categoría aparte que
  necesita autorización nombrada cada vez. Sigue valiendo el cuidado de siempre al escribir la
  migración en sí (ver "Migraciones que tocan `app_config`" más abajo), y sigue sin ser válido
  saltear la excepción explícita vigente para la tarea de hardening de WhatsApp del 2026-07-16
  (no commit/push sin autorización, "dale" antes de mergear cambios de lógica médica) — esa
  excepción es sobre commit/push/merge, no sobre correr una migración ya escrita.
- **Auto-continuar tras compresión de contexto**: Al iniciar una tarea multi-paso (3+ pasos), creá `docs/IN_PROGRESS.md`.
- **Cerrar tareas con documentación al día**.

## Reglas de commit — OBLIGATORIO seguir antes de cada push
1. **Correr el build Y los tests antes de commitear.**
2. **Nunca commitear archivos que importan módulos sin commitear.**
3. **Verificar `git status` antes del push.**
4. **No separar documentación y código si uno depende del otro; respetar siempre una instrucción
   explícita del usuario de no hacer commit/push.**
5. **Verificar en código que el bug fue realmente corregido** antes de marcarlo como resuelto.
6. **Trabajar en rama propia y abrir Pull Request hacia `main`** — nunca commit/push directo
   a `main`. El PR debe incluir resumen técnico + lista de archivos modificados.

## Migraciones que tocan `app_config` — NUNCA reemplazar el `value` a ciegas
`app_config.value` (jsonb) es la config que la doctora carga a mano en Configuración
(`whatsapp` propio de cada sede, teléfono, horarios, obras sociales, notas, link de Google Maps, etc.).
El 2026-07-05 una migración para sumar el Hospital Británico hizo
`update app_config set value = '[...]' where key = 'locations'` con un array hardcodeado
de solo 6 campos por sede, y **borró sin dejar rastro** todos los campos que ya estaban
cargados en producción (WhatsApp de Swity en Swiss Medical, teléfonos, etc.) — no eran
parte del array reescrito.
- **Nunca** escribir una migración que haga `set value = '<json literal>'` sobre una fila
  de `app_config` que la UI de Configuración pueda haber modificado en producción.
- Para agregar un elemento a un array jsonb existente: usar `value = value || '[{...}]'::jsonb`
  (concatenar), nunca reemplazar el array entero.
- Para agregar/modificar una clave puntual de un objeto: usar `jsonb_set(value, '{clave}', ...)`.
- Si hay que tocar múltiples campos de un elemento específico de un array, leer el valor actual
  primero (`select value from app_config where key = '...'`) y armar el `UPDATE` a partir de eso,
  no desde un array escrito de memoria en la migración.
- Desde el 2026-07-07 existe `app_config_history` (trigger `before update`) que guarda el valor
  anterior solo para la allowlist de claves operativas no secretas definida en SQL — sirve de red de seguridad, pero
  no reemplaza escribir la migración con cuidado.

## Cliente de Supabase con service_role — usar siempre `getServiceDb()`, nunca un cliente con cookies
Para código que necesita permisos de `service_role` (Storage, tablas con RLS restrictivo, webhooks,
cron), usar **`getServiceDb()`** (`src/lib/supabase/service.ts`) — es un cliente de `@supabase/supabase-js`
plano, sin cookies, que siempre autentica como `service_role` real.
- **Nunca** crear un cliente de `@supabase/ssr` (`createServerClient`) pasándole la `service_role` key
  junto con el `cookies` adapter. Ese patrón existió en el proyecto como `createServiceClient()`
  (ya eliminado, 2026-07-06) y tenía un bug crítico: en cuanto había una sesión de usuario activa
  (cookies de auth presentes), el cliente de `@supabase/ssr` hidrataba esa sesión y autenticaba
  **todo** — incluido Storage — como ese usuario en vez de como `service_role`. La policy de Storage
  de `content-media` solo permite escribir a `service_role` real, así que cualquier ruta que subía
  archivos con ese patrón fallaba en silencio.
- Si además necesitás verificar que hay un usuario logueado (rutas de la app, no públicas/webhooks),
  usá **dos clientes separados**: `createClient()` (`src/lib/supabase/server.ts`, cookie-aware) solo
  para `await supabase.auth.getUser()`, y `getServiceDb()` para todas las queries de negocio. Ver
  cualquier ruta de `src/app/api/google-business/` como referencia del patrón.
- Rutas públicas (`api/public/*`, callbacks de OAuth, la landing pública) no necesitan `createClient()`
  en absoluto — no hay sesión de usuario que verificar — así que usan `getServiceDb()` directamente.

## Doctora y configuración
- **Nombre**: Dra. Lucía Chahin
- **Especialidad**: Cardiología
- **Servicios**: Consulta cardiológica, Ecocardiograma
- **Ubicaciones**:
  - CIMEL Lanús
  - Hospital Británico
  - Swiss Medical Lomas
  El bot solo puede comunicar direcciones, horarios, coberturas y canales marcados como verificados
  en la configuración vigente; no tomar los valores históricos de este documento como fuente operativa.
- **Regla crítica**: La app NUNCA da diagnósticos, no reserva turnos, no confirma disponibilidad.

## Guardrails médicos (siempre activos)
- No dar diagnóstico ni tratamiento
- No interpretar estudios
- No confirmar disponibilidad ni reservar turnos
- No hablar en nombre de CIMEL ni Swiss Medical
- Ante síntomas de alarma → derivar a guardia inmediatamente
- Si la consulta es sensible → escalar a humano

## Instrucciones específicas para Claude Code
- El usuario autorizó avanzar de forma autónoma con trabajo local, pero en la tarea de WhatsApp del
  2026-07-16 pidió expresamente no hacer commit ni push sin preguntarle. Los cambios de lógica
  médica requieren además su “dale” antes de mergear/deployar. Verificar build, tests y preview
  sigue siendo obligatorio y no elimina ese gate.
- Nunca tocar `.env`/`.env.local`/secrets, ni exponerlos en output, commits o logs.
- Nunca pushear directo a `main` — usar rama + PR, incluso si el usuario no lo pide
  explícitamente en el mensaje. El PR genera un preview en Vercel; es la red de seguridad
  (poder ver que compiló y cargó bien antes de mergear), no un gate de aprobación humana.
- El resumen técnico final debe detallar cualquier cambio sensible y distinguir validación local,
  preview y ejecución real de migraciones.
- Para comandos de build/test/lint y detalles de stack, ver también `AGENTS.md`.
