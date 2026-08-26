# Lule Growth OS — Contexto para Claude

## Estado actual
- 2026-08-24 (bug real: de 2 historias evergreen salió solo la primera): reconstruido contra Meta,
  Supabase y logs de Vercel. El cron comenzó a las 18:43 ART y Meta publicó **"TU CONTROL
  CARDIOVASCULAR, SIN POSTERGACIONES"** a las 18:44, pero Vercel terminó la ruta
  `/api/cron/publish-stories` con HTTP 500; la app no llegó a guardar ese éxito ni a intentar
  **"obras sociales que atiendo"**. Causa raíz introducida ese mismo día por PR #235: el nuevo CAS
  de la Biblioteca hacía `.filter("value", "eq", JSON.stringify(expectedItems))`, serializando el
  documento JSONB completo en el query string de PostgREST. Con el tamaño real de producción,
  Cloudflare respondió `414 Request-URI Too Large` inmediatamente después del efecto externo en
  Instagram. Fix: el CAS sigue siendo atómico y conservando ediciones concurrentes, pero ahora lee
  `app_config.updated_at` como versión corta y condiciona el `UPDATE` por esa marca; la Biblioteca
  completa viaja solo en el body. La regresión usa una Biblioteca artificial de ~1 MB y confirma que
  el único predicado variable en URL es el timestamp. El predicado corto también se verificó en
  lectura contra la fila real de producción. Verificación: lint, 118 suites/1075 tests, build, CI,
  E2E público y Vercel Preview verdes. PR #236. No se tocó lógica médica, WhatsApp, RLS ni cronograma.
- 2026-08-24 (cierre de pendientes técnicos accionables): Seba confirmó que pidió la nueva
  validación/recrawl en Search Console y que regeneró la placa histórica con "SINTOMAS DE ALAMA".
  Se completó el WIP local de refresco de Biblioteca: carga inmediata + polling cada 30 segundos,
  sin requests solapados y sin consultar con la pestaña oculta. La selección automática bloquea
  copias exactas de formato/hook/caption dentro de una misma corrida, evitando repetir el incidente
  de tres historias iguales separadas por segundos. Las landings exponen `MedicalClinic` por sede y
  vinculan cada nodo al `Physician`. También se reconciliaron dos falsos pendientes ya cerrados por
  PR #206 y #232. Verificación: lint, 116 suites/1065 tests, build y 22 E2E públicos; el HTML local
  incluyó los tres nodos de sede y sus vínculos. No se tocó lógica médica, WhatsApp, RLS ni se
  agregaron crons.
- 2026-08-17 (bug real: "Publicar ahora" no publicaba y la pieza quedaba en aprobados): Seba reportó
  que un carrusel ya publicado, que borró en Instagram por tener un error, tras corregirlo y tocar
  "Publicar ahora" no se publicaba — quedaba en Aprobados, sin ningún mensaje de error. **Causa raíz**:
  al editar el CONTENIDO de una pieza aprobada/publicada, vuelve a borrador (`resetApproval` en
  `PATCH /api/content/items`), pero su `auto_publish_result` quedaba viejo (`{ instagram: "published" }`
  de la publicación anterior, que ya no existía). Al reaprobar y tocar "Publicar ahora",
  `resolveChannelsToPublish` saltea todo canal marcado `"published"`, así que la lista de canales
  quedaba **vacía**: `publishApprovedItem` no publicaba nada, `allPublished` daba `false`, la pieza
  seguía en `approved` y el front (`publishNow`) no mostraba error (HTTP 200, sin `data.error`) — un
  no-op mudo. El cron de auto-publicación NO tenía este bug porque ya limpia `auto_publish_result`
  antes de republicar una evergreen (`content-auto-publish.ts`, `if (dueRepeat) current.auto_publish_result = {}`);
  el camino manual de "Publicar ahora" nunca replicó esa limpieza. **Fix (3 partes)**: (1) root —
  `PATCH /api/content/items` ahora limpia `auto_publish_result: {}` cuando una edición de contenido
  revierte una pieza aprobada/publicada a borrador (mismo criterio que "Deshacer publicación" y el cron);
  (2) self-heal + no-op mudo — `/api/content/publish-now`: si para una pieza aprobada la lista de canales
  queda vacía (imposible en una pieza realmente publicada — estaría en `published`), el resultado es viejo
  y republica en todos los canales asignados (esto además destraba la pieza ya atascada de Seba sin
  reeditarla); (3) UI — `publishNow` ahora avisa cuando `allPublished === false`, para que un fallo real
  de un canal deje de ser un "éxito" silencioso. La proteccion contra duplicar un reintento parcial real
  (Instagram OK, Google falló → reintentar solo Google) se conserva: la lista queda vacía únicamente
  cuando TODOS los canales figuran `"published"`, no en un parcial. Tests nuevos:
  `publish-now/route.test.ts` (republica con flag viejo; no re-postea el canal ya salido en un parcial;
  rechaza pieza no aprobada) e `items/route.test.ts` (limpia el resultado al revertir por edición;
  lo conserva ante un cambio no-contenido como el cronograma). `npm test` (1054/1054), lint y build sin
  errores. Archivos: `src/app/api/content/publish-now/route.ts` (+tests),
  `src/app/api/content/items/route.ts` (+tests), `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-08-11 (bug real: historias configuradas a repetir de forma infinita no se publicaron en su
  corrida programada): Seba reportó que las historias evergreen no salieron ese día. Investigado
  contra datos reales de producción (consulta de solo lectura a `app_config`/`app_config_history`,
  sin PII): el cron de historias sí corrió a horario (18:29 ART, dentro de la ventana) y publicó
  1/1, pero ninguna de las 2 historias con `repeat_interval_days` configurado entró como candidata.
  **Causa raíz**: `isRepeatDue()` calculaba "días desde la última publicación" con horas exactas
  transcurridas (`now - updated_at`) en vez de días de calendario — y `publishApprovedItem()` pisa
  `updated_at` en CADA intento de republicar, incluso uno que falla (`auto_publish_result.instagram:
  "error"`, no solo un éxito). El historial real mostró que una de las dos piezas tuvo un intento
  fallido la noche anterior (~22:48 ART, bien fuera de la ventana normal 18:00-18:59) — probablemente
  un reintento manual — que corrió el reloj a un horario tardío. La corrida programada del día
  siguiente (18:29 ART) cayó a solo ~19,7 horas reales de esa marca: menos que el intervalo de 1 día
  exigido en horas exactas, aunque la fecha civil (ART) ya había cambiado — así que la pieza quedó
  salteada un día entero. Fix: `isRepeatDue()` ahora compara días de calendario en huso ART
  (`zonedCalendarDaysBetween`, mismo criterio que ya usa `alreadyPublishedToday` para "mismo día") en
  vez de horas exactas — un touch tardío el día anterior (por la razón que sea) ya no corre el reloj
  más allá de la fecha civil real. 2 tests nuevos que replican el escenario real reportado (mismos
  timestamps de producción) + los 91 tests existentes de `content-pipeline.test.ts` siguen pasando sin
  cambios (los casos ya escritos usan medianoche UTC, insensibles al cambio de criterio). `npm test`
  (1042/1042), lint y build sin errores. Como el intervalo de estas 2 piezas es diario y el próximo día
  programado (miércoles) no está en su cronograma (historia publica lunes/martes/jueves/sábado/
  domingo), sin este fix hubieran vuelto a repetirse recién el jueves — con el fix, la próxima corrida
  programada (jueves) ya las va a encontrar "due" con normalidad. No se forzó una publicación manual
  fuera de horario para recuperar el día perdido de hoy (acción real y visible en el Instagram en
  vivo, fuera del cronograma) — quedó a criterio de Seba. Archivo: `src/lib/content-pipeline.ts`
  (+tests).
- 2026-08-06 (mismo día, quinta vuelta sobre el cierre de historias — variedad, no siempre "agendá"):
  Seba marcó que el cierre siempre terminaba empujando a "agendá desde mi bio" y pidió variedad —
  también invitar a entrar a la bio solo para informarse más, sin mencionar turno. Revisando el
  motivo real de fondo, se encontró la causa de gran parte de la insistencia con "guardar" de la
  ronda anterior: `OBJECTIVE_GUIDANCE` (compartida por post/historia/carrusel) le dice
  explícitamente al modelo que para el objetivo "educación" el CTA debe "invitar a guardar la
  pieza" — correcto para post/carrusel (ahí "guardar" es un hábito real de Instagram), pero en
  conflicto directo con la prohibición de "guardar" que rige solo para historia. La mayoría de las
  piezas del lote de reposición de cola de la entrada de arriba tenían justamente objetivo
  "educación". `STORY_VISUAL_TEXT_RULES` reescrita con dos familias de cierre válidas según el
  objetivo editorial de la pieza — "informarse" (alcance/educación/confianza: invita a entrar a la
  bio/perfil para conocer más, sin mencionar turno) y "pedir turno" (conversión: invita
  explícitamente a agendar/reservar) — más una aclaración explícita de que la sugerencia de
  "guardar" de `OBJECTIVE_GUIDANCE` no aplica a historia. **Verificado en vivo con 4 categorías
  reales, una por objetivo**: educación/alcance/confianza dieron los tres "Entrá a mi bio para
  conocer más"/"Te invito a mi bio para conocer más" (variedad real, sin turno) y conversión dio
  "¡Reservá tu turno!" (aunque esa muestra puntual no nombró la bio explícitamente — variabilidad
  residual ya documentada, no bloqueante). `npm test` (1040/1040), lint y build sin errores.
  Archivo: `src/lib/ai.ts` (+tests).
- 2026-08-06 (mismo día, borrado + reposición manual a 2 semanas de cola + cuarta vuelta sobre el
  cierre de historias): Seba pidió borrar las historias en borrador generadas por el cron y volver
  a generar piezas para tener al menos 2 semanas de cola cubierta. Calculado contra la config real
  de `auto_publish_settings` (historia publica 5 días/semana, post 1, carrusel 2 — cada uno
  `items_per_run: 1`): objetivo a 2 semanas = 10 historias / 2 posts / 4 carruseles. Se generaron
  13 piezas nuevas llamando a la función real (`POST /api/content`, `type: "content_plan"` — la
  misma que usa "Generar propuesta completa", con una sesión autenticada real vía Playwright+TOTP,
  no una reimplementación) y se persistieron con la ruta real de guardado
  (`POST /api/content/items`). **Generando ese lote real a escala (10 historias de una), 7 de 10
  volvieron a usar el patrón "guardar"** con variantes que esquivaban la lista literal de 4 frases
  prohibidas del fix anterior (ej. "guardá esta PLACA", "guardalo" — ninguna coincidía exacto con
  las 4 frases baneadas, pero todas eran la misma idea de fondo) — 2 de esas 7 incluso repitieron
  frases literales YA prohibidas ("guarda esto", "guardá esta info"), confirmando que además de la
  laguna de alcance, el modelo tampoco sigue la regla el 100% de las veces. `STORY_VISUAL_TEXT_RULES`
  reescrita para prohibir la raíz "guard-" en cualquier conjugación/objeto, no una lista cerrada de
  frases exactas, y se sumaron 2 ejemplos válidos más (variedad). Se regeneraron las 7 no
  conformes; en esa segunda tanda aparecieron 3 nuevas que ya no usaban "guardar" ni sonaban a
  cartel, pero **directamente omitían cualquier mención a la bio/perfil** (un incumplimiento
  distinto, contra un requisito que la regla ya pedía explícitamente) — al reintentar esas 3
  puntuales se descubrió que devolvían la MISMA respuesta cacheada cada vez (mismo hash de prompt:
  categoría+objetivo+tema vacío sin variar) — se corrigieron esas 3 a mano, por edición directa de
  texto (no otra llamada a IA, dado el cacheo), agregando un cierre corto conforme ("Agendá en mi
  bio."). Estado final verificado uno por uno: 10/10 historias, 2/2 posts y 4/4 carruseles cubren
  las 2 semanas, y las 10 historias cumplen sin "guardar" y con mención explícita de bio/perfil.
  `npm test` (1040/1040), lint y build sin errores. Archivo: `src/lib/ai.ts` (+tests).
- 2026-08-06 (mismo día, dos bugs reales más de texto en la placa V1, encontrados verificando en
  vivo): Seba mandó una captura de una publicación real ya salida al aire con la palabra "seguros"
  partida con un guión al saltar de línea — "...que tus tratamientos sean se-guros." — y pidió
  arreglarlo. **Causa confirmada** (consulta directa a producción, no una hipótesis): el
  `visual_subtitle` guardado NO tenía guión — "...sean seguros." completo — así que Gemini lo
  insertó él mismo al dibujar el texto, como estrategia propia de wrap tipográfico (V1 dibuja el
  texto, no lo compone nuestro código). El prompt reforzado de más arriba en este mismo día ("nunca
  cortes/recortes texto, wrappeá como haga falta") nunca prohibió explícitamente partir una palabra
  con un guión — nueva instrucción explícita en `buildVisualPromptV1`: cada palabra completa en una
  sola línea, mover la palabra entera a la siguiente línea en vez de partirla, nunca insertar un
  guión. **Verificando este fix con una generación real** (misma categoría/pieza real que la
  publicada) apareció un SEGUNDO bug, no reportado, encontrado en el camino: Gemini dibujó la
  palabra literal **"SUBTITLE"** como si fuera parte de la placa. Causa: el prompt rotulaba cada
  string como `HEADLINE: "..."` / `SUBTITLE: "..."` pegado a las comillas — a veces el modelo
  confundía la etiqueta en inglés de la instrucción con texto real a renderizar. Reescrito para
  aclarar explícitamente que esas dos palabras son solo etiquetas de la instrucción, nunca texto a
  dibujar. **Verificado en vivo con una segunda generación real, con los dos fixes juntos**: "sean
  seguros." completo sin guión, sin ningún rastro de "SUBTITLE" ni "HEADLINE" en la imagen. `npm
  test` (1040/1040), lint y build sin errores. Archivo: `src/lib/ai.ts` (+tests).
- 2026-08-06 (mismo día, tercera vuelta sobre el cierre de las historias — "siguen siendo muy
  bruscas"): con las dos correcciones anteriores ya aplicadas (autocontenida, sin prometer datos que
  no están), Seba miró las 2 historias reales que había dejado la última corrida del cron y marcó
  que el cierre seguía sonando abrupto — "¿EL COLESTEROL ALTO SE SIENTE?" cerraba con "Link en la
  bio para tu turno en Lomas de Zamora." (un fragmento tipo cartel, sin verbo, sin calidez) y
  "¿SENTÍS VUELCOS EN EL CORAZÓN?" cerraba con "Charlemos en la consulta para que recuperes tu
  tranquilidad." (vago — ni siquiera menciona la bio). Dio la corrección exacta: "Te invito a entrar
  en mi bio para conocer más y solicitar un turno." y "Hacé clic en el link de mi bio para agendar
  una consulta y recuperes tu tranquilidad." — una invitación cálida, en primera persona, que nombra
  la acción concreta (entrar a la bio / hacer clic en el link), no una alusión vaga. `STORY_VISUAL_TEXT_RULES`
  suma una prohibición explícita de cierre telegráfico/tipo cartel (con los dos ejemplos reales que
  ya no sirven como modelo) y reemplaza los ejemplos válidos anteriores (que en retrospectiva
  también eran demasiado secos, ej. "Link en la bio para pedir turno" — un ejemplo mío del fix
  anterior que contribuyó a este mismo problema) por los dos ejemplos exactos que dio Seba. `npm
  test` (1038/1038), lint y build sin errores. **Verificado en vivo** con 3 llamadas reales a
  `POST /api/content` (`type: "content_plan"`, la misma ruta de "Generar propuesta completa" — no
  persiste nada, así que no ensució la Biblioteca) para distintas categorías de historia: 2 de 3
  salieron con el cierre cálido pedido, calcando casi textual los ejemplos de Seba ("Hace clic en el
  link de mi bio para reservar tu turno.", "Entrá al link de mi bio para reservar tu turno."). La
  tercera volvió a salir telegráfica ("Link en la bio para turnos.") — variabilidad esperada del
  modelo, no un fallo de la regla (mismo caveat de siempre: reduce el riesgo, no lo elimina del
  todo). Archivo: `src/lib/ai.ts` (+tests).
- 2026-08-06 (mismo día, regeneración + revisión visual de un carrusel puntual en borrador): Seba
  marcó que un carrusel ya existente ("TRIGLICÉRIDOS ALTOS", en Biblioteca) seguía mostrando el
  corte de texto reportado antes en su slide 2 ("...aumentando el", sin terminar la frase) y pidió
  que se regeneraran sus imágenes y que se revisara el carrusel completo. Confirmado que esas
  imágenes puntuales eran de antes del fix de truncamiento del día (el campo `slide.text` en la base
  ya estaba completo — "...aumentando el esfuerzo que debe hacer tu corazón." —, pero la imagen
  vieja, generada antes del fix, seguía con el corte). Se regeneraron las 5 imágenes (portada + 4
  slides) llamando a la ruta real `/api/content/visual` con una sesión real autenticada (login
  headless vía Playwright + TOTP con `e2e/authenticated/login-helper.ts`, mismo mecanismo que usan
  los tests E2E — no una simulación), y se persistieron en `content_pipeline` igual que hace el
  editor. **Verificado visualmente de verdad** (se descargó cada imagen final y se inspeccionó,
  no solo se confió en que la llamada a la API no tirara error): las 4 primeras salieron perfectas,
  con el texto completo — incluida la slide de 170 caracteres, el subtítulo más largo del carrusel,
  que ahora envuelve en 6 líneas sin cortarse. **Hallazgo real nuevo en la 5ta imagen (slide 4,
  "El poder de tus hábitos")**: Gemini generó la foto (persona atándose el cordón en una plaza) pero
  esa vez **no dibujó ningún texto en absoluto** — ni el titular ni el subtítulo, la placa quedó
  completamente vacía de texto. No es el mismo bug que el corte (que ya tiene causa raíz y fix real,
  ver arriba) — es la variabilidad conocida y no eliminable de un modelo generativo: V1 draws el
  texto en la misma pasada que la foto, así que ocasionalmente puede omitirlo por completo, no solo
  cortarlo. Un segundo intento (mismo prompt, misma versión) salió perfecto al toque. **No hay forma
  de detectar esto por código sin OCR** (fuera de alcance) — es exactamente para esto que la card del
  editor ya dice "Verificá que no haya diagnósticos... antes de aprobar": revisar visualmente antes
  de aprobar sigue siendo necesario, el riesgo se redujo (fix de corte) pero no se eliminó del todo
  (omisión ocasional del texto). Las 5 imágenes finales (con el reintento de la slide 4) quedaron
  persistidas en el item real. No se tocó código en este paso — es una operación de datos, para eso
  no hace falta PR.
- 2026-08-06 (3 puntos de feedback de Seba sobre "Generar placa final" e historias automáticas):
  (1) **"la V1 sigue teniendo problemas de insertar el texto y no cortarlo"** — investigado con una
  captura real de una slide de carrusel cortada a mitad de oración ("...aumentando el"). Causa raíz
  encontrada con precisión (no una hipótesis): `/api/content/visual/route.ts` truncaba
  `visual_subtitle` a 120 caracteres con `truncateForImagePlate()` antes de mandarlo a
  `generateContentVisual`, sin importar el motor. El texto de la captura mide exactamente 114
  caracteres hasta "el" — el corte cae justo donde `truncateForImagePlate` corta en el último
  espacio antes del límite de 120. Para la portada (tope de 90 caracteres) esto no se notaba nunca;
  para una slide de carrusel (tope de 300, "1-2 oraciones") sí, con frecuencia. Fix: V1 ya no trunca
  el subtítulo (Gemini dibuja el texto tal cual se le pasa, así que truncarlo producía una oración
  incompleta quemada en la imagen) — se le pasa completo y `buildVisualPromptV1` ahora exige
  explícitamente mostrar el texto COMPLETO, envolviendo en tantas líneas como haga falta y reduciendo
  el tamaño de fuente para que entre entero dentro de un margen seguro, nunca cortado ni recortado
  por el borde. V2 sigue truncando a 120 (su layout compuesto con ffmpeg, `composeContentPlate`, está
  calibrado para un texto acotado — no se tocó). (2) **"la V2 es muy mala, genera todo imágenes con
  un corte a la mitad con un texto a la izquierda y la imagen a la derecha, la V1 es mucho más
  amigable... dejá predeterminada la V1"** — confirma exactamente el diseño de V2.1 (el scrim de
  texto ocupa el 55% izquierdo, la foto el 40% derecho, ver `buildVisualPromptV2`). Se cambió el
  default de `generateContentVisual` de "v2" a "v1" (afecta piezas nuevas o sin el campo seteado
  explícitamente — una pieza donde alguien ya eligió V2 a mano sigue en V2 hasta que se cambie), se
  actualizaron los 3 lugares del editor que asumían "v2" como default (`?? "v2"` → `?? "v1"`), se
  reordenaron los botones del selector (V1 primero, "Predeterminado") y se corrigió el texto
  descriptivo de V2 para dejar de decir "sin corte al medio" (v2 sí se ve partida en dos, es
  justamente lo que Seba señaló). De paso, el control de diversidad de escena de `route.ts` (evita
  clichés y escenas repetidas, agregado 2026-08-03) se saltaba a propósito para V1 "para que siguiera
  siendo una comparación fiel con el motor histórico" — con V1 ahora como default, mantener ese salto
  hubiera sido una regresión silenciosa de calidad para la mayoría de las piezas nuevas; ahora aplica
  sin importar la versión. (3) **"las historias creadas de forma automática están muy mal, están
  creadas como si fuera a ser una publicación... alguien lee 'ecocardiograma sin misterios, cómo es
  el estudio que mira tu corazón en tiempo real' y ¿qué hace una persona con una historia así?"** —
  causa raíz: `generateContentPlan`/`buildContentPlanPrompt` nunca distinguían el formato "historia"
  de un post al pedir `visual_headline`/`visual_subtitle`, pese a que una historia se publica **sin
  caption y sin link** (`asStory` en `instagram-business.ts`: `caption: asStory ? undefined : ...`)
  — el titular/subtítulo de la placa es literalmente todo el mensaje que ve la persona, no un
  anticipo de algo que sigue (como sí lo es en un post, donde el caption completa la idea). Nueva
  regla compartida `STORY_VISUAL_TEXT_RULES` (estática, no depende del formato — se mantiene
  `cacheSystem: true` intacto) sumada a ambos generadores: para "historia" pide que el titular sea el
  mensaje COMPLETO por sí solo (un dato, recordatorio o pregunta directa, nunca un título-gancho +
  bajada explicativa estilo artículo) y el subtítulo, si se usa, sea un cierre muy breve, nunca una
  segunda oración que complete al titular. Seba avisó que iba a archivar/eliminar a mano las historias
  ya generadas por el cron con el patrón viejo — no se tocaron datos existentes, el fix aplica hacia
  adelante. `npm test` (1035/1035), lint y build sin errores. **No verificado en vivo contra la API
  real de Gemini** (una llamada de imagen real tiene costo — ver "Generación de imágenes" más abajo —
  y este entorno no corrió el flujo completo por Playwright en esta sesión): la causa raíz del punto
  (1) es un cálculo determinístico de nuestro propio código (no depende de la IA, confirmado con el
  conteo exacto de caracteres de la captura real), pero el resto de las instrucciones de prompt
  reforzadas (ajuste de tamaño/wrap en V1, tono de historia) dependen de que el modelo las siga
  razonablemente bien — no determinístico, reduce el riesgo pero no lo elimina. Archivos:
  `src/lib/ai.ts` (+tests), `src/app/api/content/visual/route.ts` (+tests),
  `src/app/(app)/contenido/instagram/page.tsx`, `src/types/index.ts`.
- 2026-08-06 (mismo día, cierre real del punto 3 de arriba): Seba pidió borrar las 5 historias en
  borrador que había generado el cron con el patrón viejo y volver a correr el cron. Confirmado por
  datos reales (consulta de solo lectura a `app_config.content_pipeline`, sin PII) que las 5 eran
  genuinamente del auto-draft: todas con `source: null`, creadas en dos tandas de segundos de
  diferencia el 2026-08-05 (19:32:15 y 19:33:50 UTC), con el patrón exacto reportado (ej.
  "ECOCARDIOGRAMA SIN MISTERIOS"/"Cómo es el estudio que mira tu corazón en tiempo real") — nada
  parecido a una creación manual de a una desde la UI. Borradas por id (mismo criterio que el `DELETE
  ?id=` de `/api/content/items`, sin tocar ninguna otra pieza). Se corrió `/api/cron/auto-draft-content`
  de verdad (server local + `curl` con el `CRON_SECRET` real, no un script que reimplementa la
  lógica) — `{"skipped":false,"planned":3,"generated":3}`, las 3 nuevas piezas salieron formato
  historia (el resto de los tracks no tenía déficit). **Cierra el "no verificado en vivo" del punto
  (3) de la entrada de arriba**: las 3 historias nuevas ya no usan el patrón título-artículo +
  bajada explicativa — ahora son preguntas de identificación o datos concretos con un cierre tipo
  CTA ("¿Cansancio extremo o falta de aire al caminar?" / "La insuficiencia cardíaca se puede tratar
  a tiempo. Guardá esta info.") — mejora real y verificada, aunque una de las tres repite la idea de
  "guardá esto" en titular y subtítulo (no es un error, solo redundante — el modelo sigue sin ser
  determinístico). El punto (1)/(2) (V1 default, corte de texto) sigue sin una generación de imagen
  real de por medio — eso mantiene su costo real, no se forzó solo para verificar. Ninguna pieza
  aprobada/publicada tocada, solo las 5 en borrador señaladas.
- 2026-08-06 (mismo día, la verificación de arriba destapó un segundo problema real): Seba revisó
  las 3 historias nuevas en la Biblioteca y marcó 3 errores concretos con captura — (1) "no se puede
  guardar una historia" (Instagram no tiene el hábito de "guardar" una historia como un post, pedirle
  eso a alguien no tiene sentido en este formato); (2) "¿QUÉ MIRA UN ECOCARDIOGRAMA?" / "3 datos
  clave sobre este estudio... Guardá esta info" — prometía "3 datos clave" y nunca los escribía en
  ningún lado; (3) "GUARDÁ ESTA LISTA PARA TU PRÓXIMO CHEQUEO" — prometía una lista que tampoco
  existía. La regla nueva del punto (3) de la entrada de arriba sacó el patrón título-artículo, pero
  el modelo se corrió a un patrón igual de roto: una promesa vacía de contenido ("datos clave",
  "esta lista") sin escribirlo, cerrando siempre con "Guardá esto/esta info/esta lista" — un CTA que
  no tiene sentido para el formato en esta cuenta. Seba dio la corrección explícita con dos reglas
  concretas: (1) las historias tienen que invitar a revisar las publicaciones del perfil o la bio
  para pedir turno, nunca a "guardar"; (2) tienen que dar información real y concreta en pocas
  palabras (ej. "¿Sabés que un electro mide esto, esto y esto? Entrá a mi perfil para conocer más" —
  con 2-3 datos reales escritos ahí, no una promesa vacía), como gancho hacia el perfil. `STORY_VISUAL_TEXT_RULES`
  (`src/lib/ai.ts`) reescrita con dos prohibiciones explícitas nuevas: nunca prometer datos/lista/
  info que no estén escritos en el titular o subtítulo mismo, y nunca cerrar con "Guardá esto" —el
  cierre siempre invita a revisar el perfil o la bio, para aprender más o para pedir turno según el
  objetivo de la pieza. Las 3 historias reportadas se borraron (a pedido explícito, "Borra todas las
  historias generadas ahora") sin volver a correr el cron todavía — antes había que corregir la
  regla. `npm test` (1035/1035), lint y build sin errores. Archivo: `src/lib/ai.ts` (+tests).
- 2026-08-06 (mismo día, cierre real: verificar la regla de arriba destapó un TERCER problema real):
  se volvió a correr `/api/cron/auto-draft-content` de verdad (server local + `curl` con el
  `CRON_SECRET` real) para confirmar la regla nueva. Mejora real: las 3 historias nuevas ya daban un
  dato concreto en vez de una promesa vacía (ej. "Medimos el tamaño de las cavidades, la fuerza del
  músculo y el funcionamiento de las válvu..."). Pero 2 de las 3 quedaron cortadas a mitad de
  palabra — **exactamente a los 90 caracteres**, confirmado por conteo exacto de caracteres.
  **Causa raíz**: `buildDraftContentItem` (`content-pipeline.ts`) y `generateContentPlan` (`ai.ts`)
  guardaban `visual_subtitle` con un `.slice(0, 90)` ciego — un tope que nunca fue un problema
  mientras el subtítulo era una bajada corta tipo tagline, pero que rompe apenas el subtítulo tiene
  que cargar un dato real (lo que la regla de arriba pide a propósito). Es la MISMA clase de bug que
  el corte de texto del punto (1)/(2) original de esta sesión (PR #219) — ahí ya existía
  `truncateForImagePlate()` (`content-text.ts`) para cortar en un límite de oración/palabra en vez de
  a ciegas, pero solo se usaba en el paso de generar la imagen (`/api/content/visual/route.ts`), no
  en el paso de GUARDAR la pieza — el subtítulo ya llegaba roto a ese paso. Fix: nueva constante
  `MAX_VISUAL_SUBTITLE_LENGTH` (140, subida de 90 — dial pensado para un dato compacto + un cierre
  breve, no un párrafo) en `content-text.ts`, y los dos puntos de guardado (`buildDraftContentItem`,
  `generateContentPlan`) ahora usan `truncateForImagePlate(texto, MAX_VISUAL_SUBTITLE_LENGTH)` en vez
  de `.slice(0, 90)` — si el modelo igual se pasa del tope, corta en un límite de oración/palabra,
  nunca a mitad de una palabra. La validación de `PATCH /api/content/items` y el contador de
  caracteres del editor (`page.tsx`) se actualizaron al mismo tope nuevo, para no rechazar ni marcar
  en rojo un subtítulo válido de hasta 140. También se sumó una guía explícita de longitud
  ("máximo 120 caracteres") al schema de `visual_subtitle` en ambos generadores — antes
  `generateContentPlan` no tenía ninguna pista de longitud para ese campo, dependía 100% del corte
  aguas abajo. **No se tocaron** `alt-text/route.ts` ni `image-direction/route.ts`: ahí el `.slice(0,
  90)` de `visual_subtitle` es solo contexto que se le pasa a la IA para otro propósito (texto
  alternativo / nueva escena), no el subtítulo que se ve en la placa — no correspondía a este bug.
  `npm test` (1038/1038), lint y build sin errores. Archivos: `src/lib/content-text.ts`,
  `src/lib/ai.ts` (+tests), `src/lib/content-pipeline.ts` (+tests),
  `src/app/api/content/items/route.ts`, `src/app/(app)/contenido/instagram/page.tsx`.
  **Verificado en vivo después de mergear** (cuarta corrida real del cron en la misma sesión, server
  local + `CRON_SECRET` real): las 2 historias nuevas de esa corrida ya no se cortan a mitad de
  palabra y quedaron correctas en los 3 frentes reportados por Seba — ej. "¿EL COLESTEROL ALTO SE
  SIENTE?" / "No da síntomas. La única forma de saberlo es con un control. Link en la bio para tu
  turno en Lomas de Zamora." (109 caracteres, oración completa, dato real, cierre hacia la bio para
  turno). Las 3 historias de la corrida anterior (generadas antes de este fix, con el corte a los 90
  caracteres todavía presente) se borraron para no dejarlas en Biblioteca con el bug ya conocido.
  Quedaron 2 historias en borrador esperando revisión de Seba.
- 2026-08-05 (feedback de Seba sobre el Estudio de contenido, 4 puntos + generación automática de
  borradores): (1) las categorías escritas a mano en "Generar contenido" (fuera de la lista
  predefinida) no se guardaban en ningún lado — se perdían al reabrir el formulario. Fix: nueva
  `listKnownCategories()` (`content-pipeline.ts`) suma cualquier `category` ya usada en piezas
  existentes a la lista predefinida `CONTENT_CATEGORIES` (antes un const local de la página), sin
  tabla ni endpoint nuevo. (2) Seba preguntó si "Tema o enfoque" podía usarse para dirigir el ángulo
  de la publicación — ya lo hacía (`buildContentPlanPrompt`/`generateContentPlan` lo pasan como
  "Tema o enfoque sugerido"), pero el texto de ayuda no lo explicitaba; reescrito para dejarlo
  explícito. (3) **bug real**: la pestaña Rendimiento no mostraba datos. Diagnosticado corriendo la
  función real `snapshotContentInsights` contra producción (no un script ad hoc — la misma función
  que usa el cron): de 12 piezas publicadas con `instagram_media_id`, solo 1 tenía snapshot en
  `instagram_media_insight_snapshots`, y la función completa las 12 en ~8s corriendo sola. En
  `daily-maintenance`, esa función corría **después** de drenar la cola de WhatsApp (presupuesto de
  hasta 120s) — la corrida real se corta por `maxDuration` antes de llegar a la mayoría de las
  piezas, sin loguear ningún error (un corte de plataforma no pasa por ningún `catch`). Se reordenó
  `runDailyMaintenance` para que los snapshots diarios (Instagram followers/content insights/Google
  Business, todos rápidos) corran primero, y el drenaje de la cola de WhatsApp (que además ya tiene
  su propio worker en vivo cada minuto vía pg_cron — esto es solo un respaldo) quede al final.
  Backfill puntual aplicado en producción corriendo la función real: la tabla pasó de 1 a 13 filas.
  (4) Seba pidió explícitamente "generación automática completa" de borradores — confirma y
  resuelve el pendiente `[BACKLOG] Cola de historias y carruseles aprobados en 0 (2026-08-05)`.
  Nuevo `src/lib/content-auto-draft.ts` (`planAutoDrafts`/`runAutoDraftGeneration`, con tests):
  compara, por cada track activo de auto-publicación (**solo post/historia/carrusel — nunca reel**,
  ver más abajo), cuántas piezas por semana necesita el cronograma (`schedule_slots.length ×
  items_per_run`) contra cuántas ya esperan revisión (borrador o aprobada); si falta, genera nuevos
  borradores con `generateContentPlan()` (mismo pipeline que "Generar propuesta completa" manual,
  vía `buildDraftContentItem()`, extraída de la página para no duplicar esa lógica) eligiendo
  categoría y objetivo por "hace más tiempo que no se usa" (nunca repite categoría dentro de la
  misma corrida, para variar el contenido) — quedan como **Borrador en Biblioteca, nunca se
  auto-aprueban ni se auto-publican**. Tope de 3 piezas por formato y 6 por corrida (un déficit
  grande se repone gradualmente en varios días). Nuevo cron `/api/cron/auto-draft-content` (11:00
  UTC = 8:00 ART, antes de las ventanas de publicación 18:00/19:00 ART) — **separado** de
  `daily-maintenance` a propósito: llamar a la IA puede tardar bastante más que el resto de las
  tareas diarias, y ese cron ya tuvo el problema de presupuesto de tiempo del punto (3) — Vercel
  Hobby ya no limita a 2 cron jobs (ver más abajo), así que sumar un quinto no tiene costo de
  infraestructura. **"reel" queda deliberadamente afuera**: ese formato depende de generar video con
  Veo (costo real ~USD 0.80-1 por intento) con su propio gate de revisión humana
  (`video_reference_frame_review`) antes de poder aprobarse — no tiene sentido dispararlo solo, sin
  que alguien lo pida a mano desde el editor. En modo manual (sin `AI_MODE=gemini_api`) se salta sin
  error, no hay forma de generar nada solo. `npm test` (999/999), lint y build sin errores. No
  verificado en vivo el cron en sí (requiere esperar a la corrida real de mañana en producción) —
  sí verificado en vivo, con las funciones reales de la app, el diagnóstico y backfill del punto (3).
  Archivos: `src/lib/content-pipeline.ts` (+`CONTENT_CATEGORIES`, `listKnownCategories`,
  `capHashtags`, `buildDraftContentItem`, exporta `DEFAULT_DUPLICATE_TOPIC_WINDOW_DAYS`),
  `src/lib/content-auto-draft.ts` (nuevo, +tests), `src/lib/daily-maintenance.ts`,
  `src/app/api/cron/auto-draft-content/` (nueva), `src/app/(app)/contenido/instagram/page.tsx`,
  `vercel.json`.
- 2026-08-04 (atribución y aprendizaje de Instagram): el enlace de una pieza conserva ahora dos
  dimensiones separadas en el mensaje prellenado del bot: `Contenido: <itemId>` y el `Ref:` de
  landing/sede. `whatsapp_sessions.content_item_id` permite comprobar una conversación aun antes de
  crear un lead; el lead guarda la pieza en `utm_content` y el código en `referral_code`. WhatsApp de
  terceros que no llegan al webhook sólo cuentan como clic. La pestaña Rendimiento compara alcance,
  guardados, compartidos, perfil, clics, conversaciones, leads y turnos con filtros de período,
  formato, día/hora, categoría, objetivo, sede y pieza. Recomendaciones sólo comparan el mismo
  formato/objetivo con ≥3 piezas por franja; aprobarlas no toca el cronograma. Migración aplicada en
  producción; operación y rollback en `docs/INSTAGRAM_ATTRIBUTION.md`.
- 2026-08-04 (historial de rendimiento de Instagram): `daily-maintenance` conserva snapshots
  idempotentes por `instagram_media_id` y día argentino en `instagram_media_insight_snapshots`.
  Las publicaciones nuevas registran `published_at` real; una migración ya aplicada en producción
  fijó la mejor aproximación disponible para las históricas. Se verificó contra la cuenta conectada
  que `views` funciona en posts/carruseles/reels y que los reels exponen tiempo total, promedio y skip
  rate; métricas no habilitadas quedan `null` sin frenar las demás. La Biblioteca muestra, en un
  detalle plegable, el snapshot más cercano a 24 h, 72 h y 7 días con tolerancia ±18 h. Sin cron ni
  variables nuevas; operación y rollback en `docs/INSTAGRAM_INSIGHTS.md`.
- 2026-08-04 (cronograma editorial de Instagram basado en insights reales): se separó el antiguo
  `/api/cron/publish-content` en mantenimiento diario, historias (18:00–18:59 ART) y feed
  (19:00–19:59 ART). Vercel Hobby permite actualmente 100 cron jobs por proyecto —el límite histórico
  de 2 ya no aplica—, aunque conserva una corrida diaria por job y precisión horaria de ±59 minutos.
  `auto_publish_settings` usa slots explícitos y timezone argentino, migra la forma legacy, valida
  duplicados/superposiciones y muestra días, ventana, próxima corrida, cola y último resultado por
  formato. No se tocó lógica médica. Detalle operativo y rollback en `docs/INSTAGRAM_SCHEDULING.md`.
- 2026-08-03 (continuación de la investigación de fallas en generación de contenido, PR #190/#191/#192):
  Seba siguió reportando que "Generar placa final" fallaba pese a tener crédito disponible en Gemini
  (confirmado con captura del panel de billing de Google AI Studio). Tres hallazgos/cambios reales:
  (1) **la generación de imagen tampoco tenía ningún reintento** (a diferencia del texto, arreglado el
  día anterior en PR #188) — reproducido en vivo que un segundo intento manual idéntico sale bien.
  `generatePhotoWithGemini()` ahora reintenta una vez más, salvo error de cuota/rate-limit (PR #190).
  (2) **hallazgo metodológico importante**: los scripts de diagnóstico "en vivo" de este proyecto
  (patrón usado desde 2026-07-19, un test de Jest que llama a la API real) **NO son representativos
  del runtime de producción** para nada que dependa del bundling de Next.js — Jest importa el módulo
  TypeScript directo, sin pasar por Turbopack/`serverExternalPackages`/`outputFileTracingIncludes`.
  Esto importa especialmente en este proyecto porque tiene un historial largo de bugs específicos de
  ese bundling (ffmpeg, fuentes .ttf). La pieza puntual reportada por Seba se reprodujo exitosamente
  con Jest, pero seguía fallando en la app real — recién se pudo reproducir de forma fiel corriendo
  `npm run build && npm run start` local + Playwright (login real, clicks reales en la UI real). Con
  esa pieza puntual, el resultado fue éxito (sin poder confirmar la causa exacta de lo que vio Seba,
  porque no dejaba ningún rastro — ver punto 3). (3) Se encontró que un fallo de `generateContentVisual()`
  **después** de que la foto ya se generó bien (ej. `composeContentPlate`/ffmpeg) no pasaba por
  `logRequest()` — quedaba completamente invisible, ni una fila en `ai_requests` ni nada en la consola
  del servidor. Se agregó el `console.error` que faltaba en el catch final de `/api/content/visual`
  (PR #191) para que la próxima vez quede un rastro real revisable en los logs de Vercel. De paso, se
  limpió en producción una frase vieja ("Render only the exact requested Spanish headline...") que
  quedó en el `image_prompt` de 3 piezas en borrador de antes del rediseño del 2026-07-30 — dato, no
  código, hecho con un script puntual leyendo/escribiendo `app_config.content_pipeline` sin tocar el
  resto de cada item. **Cierre de la investigación**: tras estos tres cambios, verificado en vivo con
  Playwright contra un build de producción real que la pieza reportada genera bien de punta a punta.
  Seba después mostró la placa resultante y pidió una feature nueva, no un bug fix (ver debajo).
  `npm test` (909-911/909-911 según el PR), lint y build sin errores en los tres.
- 2026-08-03 (selector V1/V2 para el motor de generación de la placa, PR #192): viendo la placa ya
  funcionando (punto de arriba), Seba dijo "es horrible el modelo actual" y pidió poder elegir entre
  el motor de imagen actual (V2, desde 2026-07-30: Gemini genera solo la foto, `composeContentPlate`
  arma titular/subtítulo/marca aparte por edición real) y el original (V1, hasta el 2026-07-30: Gemini
  dibuja la placa entera en una sola pasada — más "editorial"/fotográfico, pero con el riesgo real de
  texto mal escrito o inventado que motivó el cambio a V2 en su momento). El prompt V1 se reconstruyó
  **tal cual** desde el commit que introdujo V2 (`4f67944`), no es una aproximación nueva. Nuevo campo
  `ContentItem.visual_generation_version?: "v1" | "v2"` (default `"v2"` si no está seteado — no rompe
  piezas existentes), selector en la card "Placa final con Gemini"/"Portada del reel" del editor que
  se guarda al toque (mismo patrón que el toggle de "Reel de prueba") — como afecta el resultado visual
  final, cambiarlo revierte una pieza aprobada a borrador (igual que `format`/`visual_style`).
  `generatePhotoWithGemini`/`generatePhotoWithOpenAI` ahora devuelven también el `mime_type` real de
  la imagen (antes se asumía PNG vía `composeContentPlate`) — V1 lo necesita porque no pasa por esa
  composición. **Verificado en vivo** contra un build de producción real + Playwright: cambiar el
  selector a V1 en una pieza real y generar la placa dio el estilo histórico (foto + texto quemado por
  Gemini en una sola imagen), visualmente distinto del panel prolijo de V2 — confirma que el toggle
  funciona de punta a punta, no solo en tests unitarios. `npm test` (911/911), lint y build sin errores.
  Archivos: `src/lib/ai.ts` (+tests), `src/types/index.ts`, `src/app/api/content/items/route.ts`,
  `src/app/api/content/visual/route.ts`, `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-08-01 (mismo día, continuación — reintento automático antes del fallback, PR #188): Seba
  preguntó por qué fallaba Gemini en primer lugar. Respuesta: es un glitch conocido de la API de
  Gemini en modo JSON (`responseMimeType: "application/json"`) — a veces corta el texto a mitad de
  un string con `finishReason: "STOP"` (no `"MAX_TOKENS"`, o sea que no es que se quede sin
  presupuesto de tokens, decide parar antes de tiempo), de forma intermitente e independiente del
  prompt (confirmado repitiendo el mismo pedido varias veces seguidas en la investigación de PR
  #186: a veces sale bien, a veces no). Seba pidió agregar un reintento automático al mismo Gemini
  antes de recurrir al fallback a Anthropic. Implementado: `generateText()` ahora reintenta una vez
  más con el MISMO proveedor específicamente cuando el error es de truncamiento de JSON (no para
  otros errores como API key inválida o cupo agotado, que fallarían igual en el reintento — esos
  siguen saltando directo al siguiente proveedor sin gastar el reintento extra). Reduce la
  frecuencia real de fallos de forma independiente de si Anthropic/OpenAI tienen saldo cargado (ver
  punto de arriba) — no reemplaza esa necesidad, la complementa. Solo aplica a `generateText`
  (texto/JSON); la generación de imágenes no usa modo JSON, no le aplica este bug. 3 tests nuevos en
  `ai.test.ts` (se recupera solo en el reintento; agota el reintento y recién ahí falla; un error no
  relacionado con truncamiento no gasta el reintento). `npm test` (906/906), lint y build sin
  errores. Archivos: `src/lib/ai.ts`, `src/lib/ai.test.ts`.
- 2026-08-01 (diagnóstico: "falla mucho la generación de contenido", PR #186): Seba reportó que tanto
  "Generar propuesta" como "Generar imagen" venían fallando seguido. Investigado con datos reales de
  producción (`ai_requests`, misma base que local — no hay staging) y reproducido en vivo contra las
  APIs reales de Gemini/Anthropic (script temporal, descartado después). **Causa raíz encontrada**:
  (1) Gemini trunca el JSON de `content_plan` de forma intermitente (~30% en la prueba en vivo de
  hoy — bug ya conocido, `finishReason: STOP` con el texto cortado a mitad de un string, no depende
  del prompt); (2) el fallback automático a Anthropic (agregado 2026-07-19) **sí se dispara** —
  confirmado en los logs reales — pero **la cuenta de Anthropic no tiene saldo**:
  `"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to
  upgrade or purchase credits."`; (3) **bug real de código encontrado en el camino**: `generateText()`
  siempre propagaba el error del PRIMER proveedor intentado (Gemini, "JSON incompleta o inválida"),
  nunca el del último (Anthropic) — así que `getPublicAiError()`, que ya tenía prevista una rama
  específica para detectar "credit balance"/"billing" y mostrar un aviso claro, nunca llegaba a
  activarse: el usuario veía "intentá de nuevo", que no soluciona nada mientras la cuenta siga sin
  saldo. Mismo patrón corregido en `generateContentVisual()` (imágenes): si Gemini falla y el
  respaldo de OpenAI también falla, ahora se propaga el error de OpenAI (el último intentado) en vez
  del de Gemini — relevante porque el 2026-07-30 ya se había documentado que OpenAI tenía el mismo
  problema de billing (`billing_hard_limit_reached`) al verificar ese fallback por primera vez, sin
  confirmar después si se resolvió. **Fix de código ya mergeado** (`errors[errors.length - 1]` en vez
  de `errors[0]`, mismo criterio en el catch final de `generateContentVisual`), con test nuevo que
  fija el comportamiento (`ai.test.ts`). **Esto NO resuelve el problema de fondo** — es de billing, no
  de código: **pendiente que Seba cargue saldo en Anthropic Console (Plans & Billing) y revise
  OpenAI Platform → Billing** (probablemente en la misma situación desde el 2026-07-30, nunca
  confirmado que se haya resuelto). Sin esas dos cuentas de respaldo con saldo, cuando Gemini falla
  —algo que pasa con cierta frecuencia, ver punto 1— no hay red de seguridad real, por más que el
  fallback esté bien implementado; el aviso en pantalla ahora al menos va a decir claramente "no tiene
  saldo disponible" en vez del genérico de "intentá de nuevo". `npm test` (905/905), lint y build sin
  errores. Archivos: `src/lib/ai.ts`, `src/lib/ai.test.ts`.
- 2026-07-30 (mismo día, continuación — respaldo con OpenAI + corrección de costo real): Seba pidió
  sumar que ChatGPT (OpenAI) también pueda generar las fotos "si lo necesitara", después de preguntar
  la diferencia de costo entre el Gemini actual y OpenAI. **Corrección importante encontrada al
  investigar esa pregunta**: la documentación de este archivo asumía que generar la placa con Gemini
  era prácticamente gratis (por analogía con el tier gratuito de texto, `gemini-3.5-flash`) — **es
  incorrecto**, verificado contra el pricing público de Google: `gemini-3.1-flash-image` (el modelo de
  imagen real) **no tiene tier gratuito por API**, cuesta ~USD 0.045-0.151 por imagen (default
  ≈USD 0.067). Cada placa generada hasta hoy tuvo ese costo real, nunca trackeado como gasto esperado
  — recomendado que Seba revise el gasto acumulado real en Google Cloud Console → Billing (filtro
  "Generative Language API"). Comparado contra OpenAI no hay diferencia de costo significativa:
  `gpt-image-2` (el modelo vigente — NO `gpt-image-1`, que se discontinúa el 23/9/2026) cuesta
  ~USD 0.009-0.21 según calidad, mismo rango que Gemini — la decisión de sumarlo es por
  resiliencia/calidad de foto, no por ahorro. Sección "Optimización de tokens / costos de IA"
  reescrita con el número correcto, y la comparación con Veo ajustada (ninguno de los dos es gratis;
  la diferencia real es de escala de costo, no de "gratis vs. pago").
  **Implementado**: `generateContentVisual()` (`ai.ts`) ahora intenta Gemini primero (sin cambios de
  comportamiento) y, solo si esa llamada falla (cupo diario agotado, error transitorio) **y**
  `OPENAI_API_KEY` está configurada, cae automáticamente a `gpt-image-2` para generar la misma foto —
  mismo patrón que el fallback Gemini→Anthropic ya existente para texto, aplicado ahora a fotos. Sin
  `OPENAI_API_KEY` (el caso hoy), cero cambios de comportamiento. Refactor interno: `generatePhotoWithGemini()`/
  `generatePhotoWithOpenAI()` extraídas como funciones separadas, ambas logueando en `ai_requests` con
  su propio `provider` (mismo mecanismo de auditoría que ya existía, sin dashboard nuevo). Nuevas env
  vars `OPENAI_API_KEY`/`OPENAI_IMAGE_MODEL` (default `gpt-image-2`, verificado contra la
  documentación oficial de OpenAI el mismo día). **Sin límite diario propio para el respaldo** —
  decisión deliberada dado el bajo volumen de este proyecto (solo se activa cuando Gemini ya falló);
  revisar si hiciera falta un límite si el volumen cambiara. **Requiere verificación de organización
  en OpenAI** (developer console) antes de poder usar modelos GPT Image — sin eso, el fallback falla
  con un error de verificación (no rompe nada, cae al error original de Gemini si ambos fallan). `npm
  test` (893/893), lint y build sin errores. **No verificado en vivo** (este entorno no tiene
  `OPENAI_API_KEY`) — falta que Seba cargue una key real de una organización verificada para confirmar
  que el fallback funciona de punta a punta; mientras no esté configurada, el comportamiento de la app
  no cambia en nada. Archivos: `src/lib/ai.ts`, `CLAUDE.md`, `docs/BACKLOG.md`.
- 2026-07-30 (Opción A implementada: las placas ya no dependen de que la IA dibuje texto — cierra el
  punto de abajo): continuación directa de la sesión anterior (misma fecha, PR #178 ya mergeado).
  Seba pidió cotizar la Opción B (OpenAI `gpt-image-1`) antes de descartarla y avanzar con la Opción A
  de todas formas. **Costo de Opción B (búsqueda web)**: `gpt-image-1` cuesta ~USD 0.011 (baja) a
  ~USD 0.167-0.25 (alta calidad) por imagen, sin tier gratuito — pero **se discontinúa el 23/9/2026**
  (menos de 2 meses), mismo patrón que ya descartó Sora para video (`project_veo_vs_sora_decision`).
  Los sucesores (`gpt-image-1.5`/`gpt-image-2`) tienen pricing similar. Esto reforzó ir con la Opción A
  (agnóstica del proveedor de imagen) en vez de atarse a un modelo por nombre.
  **Implementado de punta a punta**: `generateContentVisual()` (`ai.ts`) ya no le pide a Gemini que
  dibuje titular/subtítulo — el prompt se reescribió para pedir SOLO la foto/escena (prohibición
  reforzada de cualquier texto/letra/logo, espacio negativo pedido en el tercio izquierdo del
  encuadre). `IMAGE_PROMPT_RULES` (compartida con `generateContentPlan`/`buildContentPlanPrompt`/
  `generateInstagramContent`/`regenerateImageDirection`) se actualizó igual — ya no le pide a la IA de
  texto que redacte instrucciones de cómo debe verse el titular dentro de la imagen. Nuevo
  `src/lib/content-plate.ts` (`composeContentPlate()`) arma la placa final por edición real con ffmpeg
  (mismo mecanismo que `burnVideoBrief` usa para los videos, ninguna dependencia nueva): panel de marca
  a la izquierda (color `paper` del sitio) + la foto de la IA a la derecha (recortada desde el borde
  derecho para preservar al sujeto) + titular en **Fraunces Bold** (última línea en acento `cardiac`,
  imitando el efecto de la referencia de ChatGPT) + subtítulo en **Inter Regular** + nombre/especialidad
  en Inter Bold + una barra de acento al pie a modo de firma de marca simplificada — **reusa la paleta
  y tipografía YA establecidas de la landing pública** (`ink`/`paper`/`cardiac`, Fraunces+Inter, ver
  `src/app/globals.css`) en vez de inventar un estilo nuevo. Tipografías bajadas de Google Fonts (SIL
  Open Font License) el mismo día a `src/lib/fonts/` (`Fraunces-Bold.ttf`, `Inter-Regular.ttf`,
  `Inter-Bold.ttf`, + `LICENSES.md`), mismo patrón que `DejaVuSans-Bold.ttf` ya bundleado. El wrap de
  líneas usa una fórmula calibrada a mano (caracteres por línea según ancho disponible y tamaño de
  fuente) — un valor optimista inicial hacía que "SÍNTOMAS DE ALARMA" pisara el borde de la foto en las
  pruebas; el valor final es deliberadamente conservador. `next.config.mjs`: `outputFileTracingIncludes`
  de `/api/content/visual` suma las 3 fuentes nuevas, y se agregó una entrada nueva para
  `/api/cron/publish-content` (también puede llamar a `generateContentVisual` como red de seguridad) —
  sin esto el deploy real de Vercel arrancaría sin los archivos. `generateContentVisual()` mantiene
  exactamente la misma firma/forma de retorno, así que ningún otro archivo (las dos rutas que la llaman)
  necesitó cambios. **Verificado en vivo de punta a punta, no solo con la foto de referencia estática**:
  llamada real a Gemini con el prompt nuevo (categoría Educación, tema "Síntomas de alarma en la mujer",
  el mismo caso exacto del bug reportado) — la foto resultante no tiene ningún texto/letra/logo
  inventado (confirmado visualmente), y compuesta con `composeContentPlate()` el resultado final tiene
  el titular/subtítulo perfectos, sin ningún error de ortografía ni línea inventada. También se probaron
  y verificaron visualmente un titular corto y el formato 9:16 (historia/portada de reel). `npm test`
  (893/893), lint y build sin errores. **El pendiente de "verificar `GEMINI_IMAGE_MODEL` en Vercel" del
  punto de abajo queda superado, no solo resuelto**: como el modelo de imagen ya no dibuja ningún texto,
  ya no importa para la confiabilidad del texto qué modelo puntual esté configurado ahí. **Pendiente
  real, queda como polish, no bloquea nada**: íconos de marca vectoriales (hoja, corazón-estetoscopio,
  latido) y una onda decorativa real en vez de la barra de acento simplificada actual — requieren assets
  de diseño que hoy no existen. **Actualización 2026-08-24:** Seba confirmó que la placa histórica con
  el typo original ya fue regenerada; no queda ninguna acción sobre esa pieza. Detalle completo,
  incluidas las capturas del
  proceso de calibración del layout, en `docs/BACKLOG.md`. Archivos: `src/lib/ai.ts`,
  `src/lib/content-plate.ts` (nuevo), `src/lib/fonts/Fraunces-Bold.ttf` (nuevo),
  `src/lib/fonts/Inter-Regular.ttf` (nuevo), `src/lib/fonts/Inter-Bold.ttf` (nuevo),
  `src/lib/fonts/LICENSES.md` (nuevo), `next.config.mjs`, `docs/BACKLOG.md`.
- 2026-07-30 (texto mal en las placas generadas por IA + revisión de cómo generamos imágenes): Seba
  reportó con captura que las placas de Instagram generadas por IA salían con el texto mal: una
  **tercera línea inventada y deforme** quemada en la imagen ("Professional medel acardiojogist del
  agottrita") y, en otra pieza, el **titular mal escrito** ("ALAMA" por "ALARMA", comiéndose el "LA").
  Investigado antes de tocar código: el texto de las placas lo **renderiza el propio modelo de imagen
  de Gemini** (`gemini-3.1-flash-image`) quemado dentro de la imagen — no lo componemos nosotros. La
  línea deforme es una alucinación clásica: el modelo agarra palabras descriptivas de la dirección
  creativa (en inglés) y las dibuja como si fueran texto. **Se verificó por git que en el repo NO
  cambió nada** que explique la regresión: el modelo de imagen, el endpoint (`.../v1/models/…`), el
  prompt de render de `generateContentVisual` (último toque #175, solo la zona segura de reels) y la
  parte de texto de `IMAGE_PROMPT_RULES` están estables desde antes de que las placas salieran bien.
  O sea el "algo se rompió" vino **de afuera del código** → causas probables: `GEMINI_IMAGE_MODEL`
  cambiado en Vercel (lo más fácil de revertir), degradación del modelo del lado de Google, o
  varianza del modelo (no determinístico). **Fix aplicado (la opción que eligió Seba, "reforzar el
  prompt")**: se endureció el prompt de `generateContentVisual` (`src/lib/ai.ts`) — whitelist
  explícito de que el ÚNICO texto permitido son el titular y el subtítulo, render carácter por
  carácter con acentos/ñ sin traducir/abreviar/reordenar/comerse palabras (con "LA" y "ALARMA"/"ALAMA"
  como ejemplos), prohibición explícita de bylines/credenciales/palabras en inglés/lettering inventado,
  aclaración de que la CREATIVE DIRECTION describe la escena y sus palabras nunca deben aparecer como
  texto, y un FINAL CHECK de cierre. `npm test` (893/893), lint y build sin errores. **No verificable
  en vivo** (este entorno en la nube no tiene `GEMINI_API_KEY`) — se confirma regenerando una placa
  real una vez deployado. Refuerza el riesgo pero no lo elimina (modelo no determinístico).
  **Contexto de producto sumado al backlog** (`docs/BACKLOG.md`, dos entradas): (1) **`[DESDE LA PC]`**
  verificar `GEMINI_IMAGE_MODEL`/`GEMINI_API_KEY` en Vercel + correlacionar con Deployments (paso que
  un agente en la nube no puede hacer); (2) **`[DECISIÓN + REVISIÓN]`** repensar cómo generamos las
  placas — Seba mostró una placa que generó con ChatGPT muchísimo mejor (texto perfecto + identidad de
  marca real: logo hoja, logo corazón-estetoscopio, "DRA. LUCÍA CHAHÍN / CARDIOLOGÍA", onda de pie,
  palabras acentuadas en color). Al pedirle a ChatGPT que explicara cómo la generó, **confirmó que él
  también dibujó el texto como píxeles en una sola imagen** (sin capas/fuentes/logos reales, no
  determinista) y **recomienda por su cuenta la "Opción A"**: que la IA genere solo la foto sin texto
  y que el titular/subtítulo/marca/íconos/ondas se compongan por código sobre una plantilla fija (SVG/
  `sharp`/canvas o el stack de ffmpeg/DejaVu de `burnVideoBrief`). Datos: el formato real era **1:1**
  (no 4:5), y el salto de estilo vino de pasarle **una captura del feed como referencia**. Conclusión
  afinada: Opción A = camino recomendado y determinista; Opción B (sumar OpenAI `gpt-image-1`) =
  opcional/complementaria, por sí sola no garantiza el texto. **Assets guardados en `docs/assets/`**:
  `placa-referencia-chatgpt-2026-07-30.png` (la referencia) y `foto-sin-texto-sintomas-mujer-1x1.png`
  (foto 1:1 sin texto, con espacio negativo a la izquierda, primer asset para prototipar). Checklist de
  assets que faltan pedir a ChatGPT en el backlog (SVGs de íconos y onda, paleta HEX, tipografías
  libres, prompt de foto reutilizable, spec de layout 1:1). **Lección**: cuando el texto de una placa
  sale mal y el código de generación no cambió, revisar primero las env vars del deploy (`GEMINI_*` en
  Vercel) antes de asumir un bug de código — este proyecto ya tuvo `GEMINI_MODEL` con una API key
  cargada por error (2026-07-15), mismo patrón de "variable sensible con valor equivocado". Todo en la
  rama `claude/image-text-generation-bug-d3k1h7`, **PR #178** abierto hacia `main` (a pedido de Seba
  al cierre). Archivos: `src/lib/ai.ts`, `docs/BACKLOG.md`, `docs/assets/` (2 imágenes nuevas).
- 2026-07-29 (trazabilidad al marcar un reel de prueba como "publicada manualmente"): continuación
  del punto de arriba — Seba pidió que, al marcar una pieza como publicada a mano (botón que existe
  desde antes para reels/carruseles posteados fuera de la API, ej. para poder agregar el sticker de
  link), quede registro de que en ese momento la pieza tenía "Reel de prueba" activado, en vez de
  perderse ese contexto. Implementado: nuevo campo `manual_publish_note?: { trial_reel, marked_at }`
  en `ContentItem`, sumado a la allowlist de `/api/content/items` (como campo no-contenido, igual
  que `auto_publish_result`, no revierte a Borrador). El diálogo de confirmación de "Marcar como
  publicada manualmente" ahora menciona explícitamente el estado de prueba cuando corresponde, y la
  card de Biblioteca muestra una nota permanente ("Publicada a mano · estaba activada como reel de
  prueba (dd/mm)") que no depende de que el toggle siga prendido después. Verificado en vivo con
  Playwright (usuario E2E real, pieza reel de prueba sembrada directo en `content_pipeline` y
  borrada después): el diálogo de confirmación mostró el texto de aviso nuevo y, tras confirmar, la
  nota apareció en la card de Biblioteca. `npm test` (893/893), lint y build sin errores. Archivos:
  `src/types/index.ts`, `src/app/api/content/items/route.ts`,
  `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-29 (insights por post/reel dejan de perderse — antes se pedían en vivo y se descartaban):
  a raíz de una duda de Seba sobre un reel (publicado con "Reel de prueba" activado, ver el punto
  de "Reels de prueba" del 2026-07-27) que no aparecía en su perfil de Instagram — se investigó y
  confirmó que el reel sí se había publicado (media_id real, contenedor esperado hasta `FINISHED`
  antes de publicar) y que no verse en el perfil es el comportamiento esperado de un Trial Reel de
  Meta (oculto para vos y tus seguidores hasta graduarlo a mano desde la app nativa; confirmado
  contra la documentación oficial de Meta, que no expone ningún campo/endpoint para consultar el
  estado de graduación por API) — Seba lo graduó manualmente desde el celular. Al preguntar cómo
  hace la app para reflejar eso, se encontró que **"Ver insights de Instagram" (reach/likes/
  comments/guardados/compartidos por post, agregado 2026-07-17) nunca guardaba nada** — se pedía en
  vivo a la API de Meta cada vez y se descartaba al cerrar la pieza o recargar la página (decisión
  explícita en su momento, ver `docs/BACKLOG.md`). Seba pidió que esta información no se pierda.
  Implementado: nuevo campo `instagram_insights` en `ContentItem` (reach/likes/comments/guardados/
  compartidos + `fetched_at`) — se guarda tanto al pedirlo a mano desde la card de Biblioteca
  (`GET /api/content/insights/[itemId]`, ahora persiste el resultado con `writeContentItems`) como
  automáticamente todos los días dentro del cron `publish-content` (`snapshotContentInsights()` en
  `src/lib/content-insights.ts`, nuevo, mismo patrón que los snapshots de seguidores de
  Instagram/Google Business ya existentes — no suma un cron job nuevo). Un fallo puntual al refrescar
  una pieza (post viejo, métrica no habilitada para ese media) conserva el último snapshot bueno en
  vez de borrarlo. La UI ahora muestra el último snapshot guardado apenas se abre Biblioteca (sin
  tener que clickear primero) y el link cambia a "Actualizar (guardado d/m/aaaa)" en vez de
  "Ver insights de Instagram" cuando ya hay un dato persistido. Tests nuevos en
  `src/lib/content-insights.test.ts` (sin conexión → no hace nada; guarda snapshot por pieza con
  `instagram_media_id` sin tocar el resto; un fallo puntual conserva el snapshot viejo de esa pieza
  sin frenar a las demás; sin ninguna pieza con media_id no escribe nada). `npm test` (893/893),
  lint y build sin errores. **No se pudo verificar en vivo contra la cuenta real de Instagram en
  este entorno** (sin credenciales de Meta acá) — la próxima corrida real del cron confirma si el
  refresco diario funciona sobre datos reales. Archivos: `src/types/index.ts`,
  `src/lib/content-insights.ts` (nuevo, +tests), `src/app/api/content/insights/[itemId]/route.ts`,
  `src/app/api/cron/publish-content/route.ts`, `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-28 (portada/miniatura para reels — antes no existía, ahora usa cover_url real de Meta):
  Seba marcó en la Biblioteca que la card de un reel mostraba el placeholder genérico "Concepto
  generado por IA" en vez de una imagen real (a diferencia de posts/historias/carruseles, que sí
  muestran su placa) y que no tenía dónde subir una portada. Investigado antes de tocar código: la
  generación de placa (`generateContentVisual`, ruta `/api/content/visual`) **nunca dejó de aceptar
  `format: "reel"`** — lo único que faltaba era la UI, oculta a propósito en PR #169 (2026-07-23)
  porque en ese momento la placa no se usaba para nada al publicar un reel (`publishReelToInstagram`
  solo usa `video_url`). Se confirmó contra la documentación oficial de Meta
  (developers.facebook.com/docs/instagram-platform) que el contenedor de un reel sí soporta un
  parámetro real, `cover_url`: una imagen JPEG propia (≤8MB, sRGB) que Meta muestra como miniatura en
  la pestaña Reels del perfil — con prioridad sobre `thumb_offset` (el frame del video que se usa si
  no se manda `cover_url`). Esto cambia el diagnóstico: ya no es solo un problema de la Biblioteca
  interna, es una limitación real de lo que se ve en el Instagram real de la cuenta.
  **Implementado**: se volvió a mostrar la card de placa para reels (mismo componente que
  post/historia/carrusel, sin duplicar código), renombrada **"Portada del reel (opcional)"** con una
  aclaración explícita de que es solo la miniatura del perfil, nunca el contenido del reel (para no
  repetir la confusión que motivó ocultarla la primera vez) — sigue sin ser obligatoria para aprobar
  ni publicar un reel, que sigue dependiendo solo de `video_url`. **Bug real encontrado en el camino**:
  `generateContentVisual` (`ai.ts`) generaba la placa de un reel en 4:5 (el ternario solo distinguía
  "historia"), no en 9:16 vertical como pide Meta para no recortar la portada — corregido para tratar
  "reel" igual que "historia" en aspecto y en la instrucción de zona segura. Como Gemini genera PNG
  por default y Meta exige JPEG para `cover_url`, se agregó `convertImageToJpeg()` (nueva, en
  `video-caption.ts`, reusa el mismo binario de ffmpeg ya bundleado) que convierte solo cuando
  `format === "reel"` — tanto en la generación con IA (`/api/content/visual`) como en la **subida
  manual** (`/api/content/upload-image`, ya soportaba PNG/JPEG/WEBP, ahora también normaliza a JPEG
  para este caso puntual). El botón "Subir imagen propia (sin generar con IA)" de esa misma card ya
  cubre el pedido explícito de Seba de poder cargar su propia portada — no hizo falta nada nuevo,
  solo dejar de ocultar la card. `coverUrl` (`item.visual_url`) se sumó a
  `createVideoContainer`/`publishReelToInstagram` (`instagram-business.ts`) y se conectó en los dos
  caminos de publicación de un reel que ya existían (`content-publish.ts` y
  `/api/instagram-business/publish`), igual que se hizo con `trial_reel` en la sesión anterior.
  `next.config.mjs` suma `outputFileTracingIncludes` para `/api/content/visual` y
  `/api/content/upload-image` (mismo bug de bundling de Vercel ya documentado varias veces con
  ffmpeg — sin esto, el binario no viaja al deploy real). **Verificado en vivo con Playwright**
  (usuario E2E real, script temporal descartado después): se abrió la pieza reel real
  "¿DÓNDE HACER TU CONTROL?" (la misma que Seba mostró en su captura), se confirmó que la card nueva
  aparece con el texto correcto y el botón de subida manual visible, y se generó una portada real con
  IA — resultado: una composición 9:16 real (no 4:5), con el titular/subtítulo bien acentuados
  quemados encima, sin errores de consola. Al volver a la Biblioteca, la card de esa misma pieza ya
  mostraba la imagen real con badge "Placa generada" en vez del placeholder — el bug reportado quedó
  confirmado corregido sobre el item real, no solo por tests. **Efecto secundario esperado, no un
  bug**: como esta pieza ya estaba "Aprobada", generar la portada la devolvió a "Borrador" — es el
  mismo mecanismo que ya existía para regenerar la placa de cualquier otro formato (edición de
  contenido revierte la aprobación, documentado desde 2026-07-08), aplicado ahora también a la
  portada del reel; queda pendiente que alguien la vuelva a aprobar a mano cuando esté conforme con
  esa imagen (se ve bien: doctora de perfil trabajando, sin inventarle el rostro, acorde a
  `IMAGE_PROMPT_RULES`). **Nota operativa de esta sesión**: para la verificación se levantó
  `npm run dev` en segundo plano y, al terminar, se cortó con `Stop-Process -Name node -Force` —
  eso mata **todos** los procesos `node.exe` de la máquina, no solo el dev server levantado acá;
  había otros procesos `node` de más temprano en la sesión que también se cortaron. Si alguna otra
  sesión/herramienta necesitaba uno de esos procesos, hay que reiniciarlo a mano. `npm test`
  (889/889), lint y build sin errores. Archivos: `src/lib/ai.ts`, `src/lib/video-caption.ts`,
  `src/lib/instagram-business.ts`, `src/lib/content-publish.ts`,
  `src/app/api/content/visual/route.ts`, `src/app/api/content/upload-image/route.ts`,
  `src/app/api/instagram-business/publish/route.ts`,
  `src/app/(app)/contenido/instagram/page.tsx`, `next.config.mjs`.
- 2026-07-28 (música de fondo sin copyright para los reels de IA — implementado, pendiente un paso
  manual de Seba para activarlo): Seba preguntó cómo sumarle música sin copyright a los reels que
  genera la app (Gemini le había sugerido buscarla "en la biblioteca de Instagram" o en Bensound).
  Investigado antes de tocar código: la biblioteca de audio de Instagram **no** es una opción acá —
  solo se puede adjuntar publicando manualmente desde la app de Instagram, no vía la Graph API que
  usa `publishReelToInstagram`. La única forma real es quemar un archivo de audio con licencia
  dentro del video antes de subirlo — mismo mecanismo que ya se usa para quemar el texto del brief
  (`burnVideoBrief`), pero mezclando audio en vez de dibujar texto. Se eligió Pixabay Music (gratis,
  licencia comercial sin atribución obligatoria) sobre una librería paga (Epidemic Sound/Artlist)
  con una mitigación real: **hallazgo en la investigación** — algunos compositores que suben a
  Pixabay también registran la misma pista en el Content ID de YouTube/Meta (a veces por colisión
  de loops compartidos entre compositores), lo que puede hacer que Instagram silencie o bloquee el
  reel después de publicado aunque la licencia esté en regla. Pixabay marca esas pistas con un
  ícono de "Content ID Registered" en la página del track — se verificaron a mano, una por una
  (visitando la página real de cada candidata), 4 pistas que NO tienen ese ícono: **Peaceful
  Morning, Warm Acoustic Guitar, Gentle Ambient Atmosphere, Calm Classical Piano** (las 4
  instrumentales, tono cálido/calmo, coherente con el resto de la cuenta — detalle completo, links
  reales a cada página de Pixabay y la referencia sobre el riesgo de Content ID en
  `src/lib/audio/reel-music/LICENSES.md`). Implementado `addBackgroundMusic()` en
  `video-caption.ts`: reemplaza el audio ambiente que genera Veo (impredecible, "ambient sound
  only" por `VIDEO_PROMPT_RULES`) por una de las 4 pistas elegida al azar, recortada a la duración
  real del clip (ffprobe) con fundido de entrada/salida y volumen atenuado (queda de fondo detrás
  de las tarjetas de texto, no compite por la atención) — wireado en `/api/content/video` como
  último paso antes de persistir en Storage, mismo patrón defensivo que el brief (si falla, sigue
  con el video tal cual antes que perder la generación de Veo, que tiene costo real). **Diseño
  fail-open a propósito**: si en `src/lib/audio/reel-music/` no hay ningún `.mp3` todavía,
  `addBackgroundMusic()` devuelve el video sin tocar — no bloquea nada. **Pendiente real, bloqueado
  por algo que no se puede resolver por código**: los 4 archivos `.mp3` reales todavía NO están en
  el repo — el botón de descarga de Pixabay está protegido por un desafío de Cloudflare Turnstile
  (CAPTCHA) que un script no puede resolver, confirmado intentándolo (la descarga automática
  devolvió la página de login de Pixabay en vez del audio). **Seba tiene que bajar los 4 archivos a
  mano** (un click en "Free download" en cada link de la tabla de `LICENSES.md`, ~2 minutos) y
  guardarlos en `src/lib/audio/reel-music/` con el nombre exacto que indica esa tabla — recién ahí
  la música se activa sola, sin tocar código de nuevo. **Verificado en vivo**: la lógica de mezcla
  de ffmpeg (recorte a duración, fundidos, volumen, reemplazo de audio sin recodificar el video) se
  probó con un video y una pista de audio sintéticos (gratis, sin gastar cupo de Veo) — el output
  dio exactamente 8s, con el audio de reemplazo correctamente recortado desde una pista de 30s.
  Mismo bug de bundling de Vercel que en features anteriores de este archivo (fuente/binarios de
  ffmpeg): `outputFileTracingIncludes` en `next.config.mjs` ahora también incluye
  `src/lib/audio/reel-music/**`, si no el deploy real arrancaría sin los archivos y fallaría (o,
  acá, degradaría en silencio al fail-open) recién al primer uso, no en build. `npm test`
  (889/889), lint y build sin errores. Archivos: `src/lib/video-caption.ts`,
  `src/app/api/content/video/route.ts`, `next.config.mjs`, `src/lib/audio/reel-music/LICENSES.md`.
- 2026-07-28 (3 bugs reales en el texto que genera la IA para Instagram, reportados por Seba con
  capturas de un reel real): (1) el caption escribió "un ano" en vez de "un año" (sin la ñ, cambia
  completamente el significado de la palabra); (2) el hook/caption usaba "cardiólogo" en masculino
  para referirse a la especialidad, pese a que la Dra. Lucía es mujer; (3) el "Atiendo en" del
  caption decía siempre "Hospital Británico" a secas, sin el "(Central)" que sí usan las landings
  públicas (`public-landings.ts`, `landings/[slug]/page.tsx`) para distinguirlo de otros centros de
  la red Hospital Británico — información real que podía confundir a un paciente sobre a qué
  edificio concurrir. **Causa raíz de (1) y, en parte, de (3)**: el pipeline automático que arma
  este contenido (`generateContentPlan`, la función real detrás de "Generar propuesta completa" en
  modo IA — no `buildContentPlanPrompt`, que es solo el modo manual) tiene su system prompt escrito
  íntegramente en español SIN tildes ni "ñ" (por practicidad del desarrollador, ej. "espanol",
  "cardiologa", "atendes"), incluyendo el hecho literal "Hospital Britanico" sin acento como parte
  de "dónde atendés" — sin ninguna regla que le aclarara al modelo que ese estilo interno no debía
  imitarse en la respuesta final, y sin el sufijo "(Central)" en ese dato. Fix: se agregaron dos
  reglas nuevas a `PLAIN_TEXT_RULES` (compartida por `generateContentPlan`, `buildContentPlanPrompt`,
  `generateInstagramContent` y `generateGooglePost`) — una de ORTOGRAFÍA que aclara explícitamente
  que las instrucciones internas están sin tildes por practicidad pero que la respuesta SIEMPRE debe
  llevarlas, con el propio caso real "año" no "ano" como ejemplo; y una de GÉNERO que prohíbe
  "cardiólogo" en masculino y pide "cardióloga"/"consulta cardiológica"/"cardiología" en su lugar.
  Las mismas dos reglas se sumaron también a `VIDEO_BRIEF_RULES` (usada por `generateVideoBrief`
  para el gancho/mensajes/CTA de la microinfografía animada de reels, que no incluye
  `PLAIN_TEXT_RULES`). Se corrigieron además los 4 lugares donde el nombre de la sede se pasaba sin
  tilde y sin "(Central)" como dato literal (`HASHTAG_RULES`, y los system prompts de
  `generateContentPlan`, `generateGooglePost` y `buildContentPlanPrompt`), alineándolo con el nombre
  ya usado en las landings públicas. El ejemplo de gancho "3 señales para consultar al cardiólogo"
  en `VIDEO_BRIEF_RULES` se cambió a "consultar con cardiología". **Verificado en vivo** con una
  llamada real a Gemini (script temporal descartado después, sin tocar Supabase) replicando el
  system prompt corregido para un reel de "Chequeo cardiovascular": el resultado real usó "más de un
  año" (con ñ), "¿Creés que solo tenés que ir a la cardióloga...?" (femenino) y "Miércoles en Hospital
  Británico (Sede Central)" — los tres bugs no se reprodujeron. No se regeneró el contenido de la
  pieza real que Seba mostró en las capturas — el fix aplica hacia adelante, a la próxima vez que se
  genere o regenere una propuesta. `npm test` (889/889), lint y build sin errores. Archivo:
  `src/lib/ai.ts`.
- 2026-07-27 (Reels de prueba de Instagram — "Trial Reels"): Seba avisó que la cuenta ya superó el
  umbral de seguidores que Meta exige para poder publicar reels de prueba (mostrados solo a gente que
  no lo sigue, para testear una idea antes de decidir mostrarla a la audiencia habitual) y pidió
  sumar esto a la app. Investigado antes de tocar código: la API de Meta (Instagram Graph API /
  Content Publishing) sí soporta esto de forma nativa — al crear el contenedor de un reel
  (`media_type=REELS`), se puede sumar `trial_params: { graduation_strategy: "MANUAL" | "SS_PERFORMANCE" }`.
  Se usó `"MANUAL"` a propósito: el reel de prueba nunca pasa solo al feed de los seguidores por una
  métrica de performance automática, la decisión de "graduarlo" queda siempre en manos de la Dra.
  Lucía desde la app nativa de Instagram, después de ver los resultados. Implementado: nuevo campo
  `trial_reel?: boolean` en `ContentItem` (no afecta el contenido en sí, es config de a quién se le
  muestra — no resetea la pieza a borrador al cambiarlo, mismo criterio que `repeat_interval_days`);
  `createVideoContainer`/`publishReelToInstagram` (`instagram-business.ts`) arman el `trial_params`
  cuando corresponde; wireado en los dos caminos de publicación de un reel que ya existían
  (`content-publish.ts`, usado por el cron y por "Publicar ahora"; y `/api/instagram-business/publish`,
  usado por "Publicar solo en Instagram" desde el editor) — ninguno nuevo, ambos ya publicaban reels
  normales desde antes. En el editor, la tarjeta "Video del reel" suma un interruptor "Reel de prueba
  (mostrar solo a no-seguidores)" con la explicación de qué hace y que la graduación es siempre manual;
  la card de Biblioteca muestra un badge "Prueba" cuando está activado, para verlo de un vistazo sin
  entrar al editor. **No hay ninguna automatización de "graduar" el reel** — eso Meta solo lo permite
  desde la app nativa, no hay endpoint de API para hacerlo por acá. Verificado en vivo con Playwright
  (usuario E2E real, script temporal descartado después): el toggle aparece en una pieza reel nueva,
  cambia a "Activado" al tocarlo, sigue "Activado" al salir a Biblioteca y volver a abrir la pieza
  (confirma que quedó persistido en el servidor, no solo en memoria del navegador), y el badge
  "Prueba" es visible en la card de Biblioteca — 0 errores de consola. `npm test` (889/889), lint y
  build sin errores. Archivos: `src/types/index.ts`, `src/lib/instagram-business.ts`,
  `src/lib/content-publish.ts`, `src/app/api/content/items/route.ts`,
  `src/app/api/instagram-business/publish/route.ts`, `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-23 (mismo día, feedback de Seba tras seguir sin entender el panel del reel): a pesar del
  reordenamiento del punto anterior, Seba seguía sin entender la diferencia entre "Generar propuesta"
  y "Generar video con IA", y marcó que el "Guion del reel silencioso" (Escena 1/2/3, con texto en
  pantalla + dirección de toma) no le hacía sentido — "no necesito un guionista, si subo el video es
  porque ya lo armé". Se eliminó el sistema de escenas/guion por completo (era un segundo sistema de
  contenido, paralelo y no coordinado con la microinfografía de Veo — nada impedía generar el video
  con IA y después quemarle encima el texto de las escenas también, duplicando texto sobre texto).
  Alcance del borrado: `ContentScene`/`scenes`/`reel_duration_seconds` (tipos, generación en
  `generateContentPlan`/`buildContentPlanPrompt`, `REEL_SCENE_RULES`), la función
  `burnCaptionsOntoVideo()` y la ruta `/api/content/video-caption` completa (existían solo para
  quemar el texto de las escenas — `burnVideoBrief()`, la del camino de Veo, sigue intacta), la UI de
  Escena 1/2/3 + "Agregar escena" + "Agregar texto del guion al video", y la validación/allowlist de
  esos campos en `/api/content/items`. **Bug real encontrado en el camino**: `next.config.mjs` tenía
  `outputFileTracingIncludes` apuntando a la ruta `/api/content/video-caption` (para bundlear
  ffmpeg/ffprobe/la fuente DejaVuSans-Bold.ttf en el deploy de Vercel) — al borrar esa ruta, ese
  tracing quedó apuntando a nada, así que `/api/content/video` (la ruta que sigue usando esos mismos
  binarios/fuente vía `burnVideoBrief`) se hubiera quedado sin ellos en producción. Corregido
  apuntando el tracing a `/api/content/video`. Segundo pedido de Seba en el mismo mensaje: "quiero
  entender o leer que va de prompt para armar el video" — el prompt en inglés para Veo ya se mostraba,
  pero escondido detrás de un toggle "Ver detalle técnico" que aparentemente no se notó; se sacó el
  toggle y ahora se muestra siempre, apenas se genera una propuesta, con la etiqueta más explícita
  "Prompt en inglés que se le manda a Veo (fondo/animación del video)". Verificado en vivo con
  Playwright (usuario E2E real): pieza reel nueva no muestra "Guion del reel silencioso" ni "Escena"
  ni "Agregar escena" en ningún lado; al generar una propuesta, el prompt de Veo es visible sin tener
  que expandir nada — 0 errores de consola. `npm test` (889/889), lint y build sin errores. Archivos:
  `src/types/index.ts`, `src/lib/ai.ts`, `src/lib/video-caption.ts`,
  `src/app/api/content/video-caption/` (eliminada), `src/app/api/content/items/route.ts`,
  `src/app/(app)/contenido/instagram/page.tsx`, `next.config.mjs`, `src/lib/instagram-business.ts`
  (comentario obsoleto).
- 2026-07-23 (mismo día, feedback de Seba mirando el editor de una pieza reel): marcó que el layout
  del editor no tenía sentido para un reel — la columna central seguía mostrando "Placa final con
  Gemini" (generación de imagen) como panel principal, mientras que la generación/subida real del
  video (lo único que un reel necesita para publicarse) quedaba escondida al final de la columna
  derecha, debajo de hook/caption/hashtags/checklist — y las escenas del guion aparecían todavía más
  abajo, después de eso. Investigado antes de tocar código: confirmado que la placa/`visual_url` no se
  usa para NADA en un reel — ni `publishReelToInstagram` (`instagram-business.ts`, solo usa
  `video_url`+`caption`) ni el gate de aprobación (`reelVideoReady`, no `displayedVisualUrl`) la
  referencian — mostrarla como panel principal para este formato era directamente contenido muerto que
  confundía sobre qué hace falta para publicar. Fix: la card "Placa final con Gemini" ahora se oculta
  cuando `isReel` (`!isReel &&`); en su lugar aparece una card nueva "Video del reel" en la misma
  posición (columna central) con TODO lo que antes vivía disperso en la columna derecha — guion +
  duración, video actual, Microinfografía animada (Veo + texto real), subir video, y la lista de
  escenas con "Agregar texto del guion al video" — movido tal cual, sin reescribir lógica ni handlers,
  solo reubicado. El formato Post/Historia sigue mostrando "Placa final con Gemini" exactamente igual
  que antes (sin cambios ahí). Verificado en vivo con Playwright (usuario E2E real): se creó una pieza
  reel en blanco y se confirmó que "Video del reel" es visible y "Placa final con Gemini" NO lo es; se
  creó una pieza post en blanco de control y se confirmó lo inverso — 0 errores de consola en ambos
  casos. `npm test` (889/889), lint y build sin errores. Archivo:
  `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-23 (mismo día, feedback de Seba mirando un frame real): al revisar un frame del video
  generado con Veo, Seba marcó dos cosas — arriba del todo aparecía un "9:16" tipo reloj de celular y
  la palabra "caustion" (sin sentido) junto a íconos, y en ningún lado del video decía "Dra. Lucía
  Chahin". La primera es un bug real: Veo interpretó el ícono de tensiómetro/gauge que pedía el prompt
  como si fuera la captura de pantalla de una app de salud, y agregó por su cuenta una barra de estado
  de celular con un nombre de app inventado — la regla vigente ya prohibía "interfaces médicas
  inventadas" pero nunca contempló específicamente un mockup de teléfono/app (una alucinación distinta:
  no es una interfaz médica ficticia, es que Veo enmarcó todo el plano como si fuera la pantalla de un
  dispositivo). Fix en `VIDEO_PROMPT_RULES` (`src/lib/ai.ts`): nueva prohibición explícita de mockup de
  teléfono/app (nunca un dispositivo dentro del cuadro, nunca barra de estado/reloj/iconos de
  notificación/señal/batería, nunca un nombre de app o logo inventado — el plano tiene que ser una
  ilustración a pantalla completa/full-bleed) y refuerzo en inglés al final del prompt. La segunda no
  es un bug sino una mejora real: se agregó un crédito de marca fijo "Dra. Lucía Chahin · Cardióloga"
  quemado por edición real (`BRAND_LABEL` en `video-caption.ts`, dentro de `burnVideoBrief()`) — no
  depende de lo que Veo decida generar, aparece siempre, en toda la duración del video, con un fundito
  de entrada de 0,3s. Verificado con un frame sintético gratis (sin gastar cupo de Veo): el crédito de
  marca es legible y no choca con la tarjeta del gancho (deja un margen amplio entre ambos, `y=26` para
  el crédito vs `y=h*0.14` donde arranca el gancho). **Pendiente real, no verificado todavía**: falta
  una segunda generación real de Veo con el prompt reforzado para confirmar que la instrucción nueva
  evita el mockup de teléfono/app en la práctica (el fix del crédito de marca sí queda verificado, es
  independiente del modelo de video). `npm test` (889/889), lint y build sin errores. Archivos:
  `src/lib/ai.ts`, `src/lib/video-caption.ts`.
- 2026-07-23 (cierre real del pendiente de la microinfografía animada, PR #166): quedaba explícitamente
  sin verificar un video de Veo real con el prompt nuevo (fondo/animación, sin consultorio). Con el cupo
  diario ya subido a mano por Seba (`DAILY_VIDEO_GENERATION_LIMIT=5` en `.env.local`), se generó un video
  real (categoría "Presión arterial") y se compuso con `burnVideoBrief()` de punta a punta contra la UI
  real. Primera corrida: un frame mostró una tarjeta de texto casi invisible ("Si se repite, es momento de
  consultar."), diagnosticado en el momento como falta de bitrate (ffmpeg sin `-crf` explícito
  recodificaba a ~380kb/s) — se agregó `-crf 18 -preset medium` a los dos comandos de ffmpeg de
  `video-caption.ts`. **Al re-verificar con una segunda generación real de Veo y una grilla de frames cada
  0,5s (no solo 4 puntos sueltos), se confirmó que esa "falta de legibilidad" nunca fue un bug de
  encoding**: con 3 mensajes repartidos en la ventana de 1,2-6,2s, cada tarjeta dura ~1,67s con 0,25s de
  fundido de entrada/salida (`fadeAlphaExpr` en `video-caption.ts`) — el frame de la primera verificación
  cayó, por casualidad, a 33ms del final del fundido de salida de esa tarjeta puntual, mostrándola casi
  transparente. Es el comportamiento esperado de un fundido, no un defecto. La grilla completa (16 frames)
  mostró las 5 tarjetas (gancho, 3 mensajes, CTA) perfectamente legibles durante toda su ventana real de
  exhibición. El fix de `-crf 18 -preset medium` se mantiene igual (mejora real de calidad del archivo
  maestro, sin costo relevante en un clip de 8s) pero **no era la causa** del problema reportado — no
  había ningún bug de legibilidad que corregir. Lección para no repetir: al verificar un video con
  fundidos, extraer frames cada 0,3-0,5s en vez de puntos sueltos elegidos a mano, para no confundir un
  instante de transición intencional con un defecto real. `npm test` (889/889), lint y build sin errores.
  Archivo: `src/lib/video-caption.ts`.
- 2026-07-22 (mejora, no bug: estrategia de hashtags para llegar a gente fuera de los seguidores):
  Seba pidió revisar si había que cambiar los hashtags de Instagram para captar personas por fuera
  del seguimiento de la cuenta. Se revisaron en vivo (consulta de solo lectura a `app_config` /
  `content_pipeline`, sin PII, contenido de marketing) los hashtags reales de las 12 piezas
  aprobadas/publicadas: todas caían en un único nivel (nicho cardiológico + marca, ej.
  `#Cardiologia #SaludCardiovascular #ChequeoPreventivo #DraLuciaChahin` repetidos en casi todas),
  solo 2/12 incluían geolocalización y ninguna usaba un hashtag amplio/alto volumen. La guía vigente
  de Instagram para 2026 (Later, Sprout Social) confirma que mezclar niveles de volumen (alto +
  medio + nicho) aumenta 35-60% el alcance entre no seguidores vía "hashtags superpuestos" con
  contenido de nichos similares — repetir siempre el mismo combo de nicho deja la cuenta encerrada
  en la misma audiencia chica. Fix: nueva regla compartida `HASHTAG_RULES` en `src/lib/ai.ts` —
  pide explícitamente una mezcla de 3 niveles (1 amplio tipo `#Salud`/`#CorazonSano`, 1-2 de nicho
  específicos del tema, 1-2 de geolocalización según la sede más relevante: Lanús/CIMEL, Hospital
  Británico/CABA, Lomas de Zamora/Swiss Medical) y baja `#DraLuciaChahin` de fijo-en-cada-post a
  opcional (un hashtag de marca ayuda a que te encuentren los que ya te conocen, no a sumar gente
  nueva). Un único const, cableado en los tres generadores que producen hashtags
  (`buildContentPlanPrompt`, `generateContentPlan`, `generateInstagramContent`), mismo patrón que
  otras reglas compartidas de este archivo. **Verificado en vivo** con llamadas reales a Gemini
  (script temporal descartado después, sin tocar Supabase) comparando la regla vieja contra la
  nueva para las mismas categorías: con la regla vieja, siempre el mismo combo de nicho/marca
  (`#Colesterol #SaludCardiovascular #Cardiologia #ChequeoMedico #PrevenirEsCurar`); con la regla
  nueva, mezcla real de niveles (`#CorazonSano #Colesterol #Lanus`, `#CorazonSano #Cardiologo
  #Lanus #CABA`). No se regeneraron los hashtags de piezas ya aprobadas/publicadas — el fix aplica
  hacia adelante. `npm test` (889/889), lint y build OK. Archivo: `src/lib/ai.ts`.
- 2026-07-19 (bug real: la placa de "Un estudio simple para tu tranquilidad" mostró un ecógrafo con el
  transductor sobre el abdomen, no un ecocardiograma): Seba volvió a regenerar la placa de esta misma
  pieza (después del fix de género de más arriba) y esta vez el transductor apareció apoyado sobre el
  abdomen de la paciente, en una pose reconocible como ecografía obstétrica/abdominal — no un
  ecocardiograma, que se hace con el transductor sobre el pecho/tórax, cerca del corazón. Causa:
  `IMAGE_PROMPT_RULES` pedía "equipo correspondiente al estudio mencionado en uso" pero nunca
  especificaba DÓNDE del cuerpo va el transductor ni QUÉ tiene que mostrar el monitor — dejaba esos dos
  detalles librados a la interpretación genérica del modelo, y "ecografía"/"ultrasound" tiene un prior
  cultural mucho más fuerte hacia la pose obstétrica (abdomen) que hacia la cardíaca. **Verificado en
  vivo**: pidiendo la misma escena varias veces sin esta regla, algunas corridas ya decían "chest"
  correctamente pero otras no mencionaban ninguna ubicación anatómica en absoluto (dejando la puerta
  abierta al bug real). Fix: se suma una instrucción explícita en `IMAGE_PROMPT_RULES` — para un
  ecocardiograma, el transductor tiene que ir sobre el pecho/tórax cerca del corazón (nunca el abdomen,
  aclarando explícitamente que esa es la confusión más común de la palabra genérica "ecografía"), y si
  el monitor es visible tiene que mostrar una vista cardíaca (cámaras del corazón), no una imagen
  fetal/abdominal — mismo criterio generalizado a cualquier otro estudio nombrado (el posicionamiento y
  lo que se ve en pantalla tienen que corresponder exactamente a ESE estudio, no a uno similar o más
  genérico). Verificado en vivo repitiendo el pedido con la regla nueva: todas las corridas especifican
  "chest, near the heart" y una vista de "heart chambers", nunca abdomen. `npm test` (884/884), lint y
  build OK. Archivo: `src/lib/ai.ts`.
- 2026-07-19 (bug real: al regenerar la dirección visual de "Un estudio simple para tu tranquilidad"
  con las reglas de consultorio del fix anterior, la placa mostró la mano/brazo de un médico HOMBRE
  apoyada en el hombro de la paciente): Seba lo marcó de inmediato — la Dra. Lucía Chahin es mujer,
  cualquier figura médica en las placas tiene que leerse como femenina. Causa: `IMAGE_PROMPT_RULES`
  solo decía "no representar a una médica real ni inventar el rostro de la Dra. Lucía Chahin" —
  suficiente para no inventarle la cara, pero sin ninguna instrucción sobre el género cuando la escena
  incluye una figura médica parcial (mano, brazo, guardapolvo, sin rostro) — el fix anterior (placas
  ambientadas en consultorio) hizo más probable que esas figuras parciales aparecieran, y sin una regla
  explícita el resultado quedaba librado al azar. **Verificado en vivo**: pidiendo la misma escena varias
  veces sin esta regla, unas veces el modelo ya decía "female cardiologist" y otras dejaba la descripción
  ambigua (la que generó el bug real, con un guardapolvo sobre un sweater azul marino sin ninguna señal
  de género) — intermitente, no determinístico. Fix: se suma una instrucción explícita en
  `IMAGE_PROMPT_RULES` — si aparece una figura médica aunque sea parcial, tiene que leerse
  inequívocamente como femenina (mano/muñeca femenina, nunca ambigua ni masculina), sin inventar el
  rostro real. Verificado en vivo repitiendo el mismo pedido con la regla nueva: siempre especifica
  "female cardiologist" / "clearly feminine" en el prompt resultante. `npm test` (884/884), lint y
  build OK. Archivo: `src/lib/ai.ts`.
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
- 2026-08-26: la agenda pública quedó actualizada con cuatro sedes/bloques de atención: CIMEL
  Lanús (martes 13:00–15:00; jueves y viernes 13:00–16:00), Hospital Británico Lanús
  (ecocardiogramas los martes 16:00–19:30), Hospital Británico Central (miércoles
  17:00–19:45) y Swiss Medical Lomas (viernes 17:00–20:00). Las landings derivan a los canales
  oficiales de cada institución y no dependen del bot de WhatsApp para pedir turno.
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
- 2026-07-23 (video de reels generado con IA, Veo — PR #161 fue la publicación con video propio
  subido a mano; esta es la segunda mitad, generarlo con IA): Seba pidió explorar reels con IA.
  Se comparó en vivo Veo (Google) contra Sora (OpenAI) con generaciones reales de las dos APIs antes
  de elegir — Sora tenía mejor fama de calidad (coincidía con la experiencia de Seba probándolo el
  día anterior), pero su Videos API se apaga el 24/9/2026 sin sucesor anunciado: se descartó por
  ahora ("dejemos Sora para una 2da etapa"), Veo no tiene fecha de corte anunciada. A pedido
  explícito de Seba, regla obligatoria en todo el contenido generado: nunca una persona hablando a
  cámara (se nota demasiado como IA, rompe la confianza) — mismo criterio que ya regía el guion
  manual de reels, ahora encodeado en `VIDEO_PROMPT_RULES` (`src/lib/ai.ts`) con instrucción
  explícita de audio ("ambient sound only, no dialogue") porque Veo genera audio nativo y sin esa
  aclaración puede inventar voces falsas. Implementado: `generateVideoDirection()` (propone
  `video_prompt`) + `generateContentVideo()` (llama a Veo, sondea la operación asincrónica de larga
  duración cada 10s hasta 1-3 min, descarga y devuelve el video — Google solo lo deja disponible
  48hs en su propia URL); dos rutas nuevas (`/api/content/video-direction`,
  `/api/content/video` con `maxDuration = 280`, la más alta del proyecto); botones "Proponer
  dirección con IA" / "Generar video con IA" en el editor de una pieza reel, junto a la subida
  manual ya existente. Límite diario propio y más estricto (`DAILY_VIDEO_GENERATION_LIMIT`, default
  3) separado de `DAILY_AI_REQUEST_LIMIT` porque, a diferencia de las placas, Veo no tiene tier
  gratuito — cada generación exitosa cuesta real (~USD 0.80-1 por clip de 8s en el tier Fast).
  **Verificado en vivo de punta a punta** con Playwright (usuario E2E real): se creó una pieza reel,
  se generó un video real con Veo a través de la UI/ruta real (no un script aparte), y se confirmó
  que el `<video>` del editor lo reproduce sin errores de consola. En el camino se encontró que la
  primera corrida SÍ mostraba un error real de CSP bloqueando el `<video>` — pero la causa no fue el
  código nuevo: un servidor de desarrollo viejo, sobreviviente de antes en esta misma sesión, seguía
  respondiendo en el puerto 3000 sin el fix de `media-src` que ya se había mergeado en el PR
  anterior (#161) — el comando de reinicio no lo mató por un detalle del regex de coincidencia de
  proceso. Al matar ese proceso viejo y limpiar el caché de `.next`, la generación repetida cargó
  limpia — esto de paso fue la primera confirmación real de que el fix de CSP de PR #161 funciona
  (nunca se había cargado antes un `<video src>` real en el navegador para probarlo). `npm test`
  (889/889), lint y build sin errores. Pendiente explícito, no abordado: sumar `video_prompt` al
  flujo principal de generación de contenido (`generateContentPlan`) para que un reel nuevo ya salga
  con dirección de video propuesta sin un paso manual aparte — quedó fuera de alcance a propósito
  para no tocar esa función central (900+ líneas, prompt médico-sensible) en la misma pasada.
  Archivos: `src/lib/ai.ts`, `src/types/index.ts`, `src/app/api/content/video/`,
  `src/app/api/content/video-direction/`, `src/app/api/content/items/route.ts`,
  `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-23 (mismo día, texto quemado sobre el video del reel — ffmpeg): Seba preguntó si el texto
  se iba a ver en español dentro del video (no — Veo tiene prohibido renderizar texto en el plano, a
  propósito: los modelos de video generativo son mucho peor que los de imagen escribiendo texto
  legible, riesgo real de letras deformes en una cuenta médica) y si se podían hacer "videos
  interactivos" tipo "cómo pedir turno" con texto superpuesto — eso sí requería agregar edición de
  video real, no solo prompting. A pedido explícito, se construyó: `src/lib/video-caption.ts`
  (`burnCaptionsOntoVideo`) quema el `onScreenText` de `item.scenes` (el guion, ya existente) sobre
  CUALQUIER video de la pieza (generado con IA o subido a mano) usando ffmpeg (`@ffmpeg-installer/
  ffmpeg` + `@ffprobe-installer/ffprobe`, nuevas dependencias) — botón "Agregar texto del guion al
  video" en el editor, ruta `/api/content/video-caption`. **Decisión tecnica clave**: el texto de
  cada escena se pasa a `drawtext` via `textfile=` (un archivo aparte por escena), nunca inline
  (`text=`) -- evita tener que escapar a mano tildes/eñes/comillas/dos puntos del texto en español
  dentro del filtergraph de ffmpeg, delicado de hacer bien. El guion (`REEL_SCENE_RULES`) esta
  pensado para un reel filmado a mano de hasta 25s; un clip de Veo dura como maximo 8s -- se detecta
  la duracion real con ffprobe y solo se queman las escenas cuyo inicio entra en esa duracion, las
  que no entran simplemente no se muestran (no rompe nada). Fuente propia bundleada
  (`src/lib/fonts/DejaVuSans-Bold.ttf`, licencia libre Bitstream Vera/DejaVu, elegida por su buena
  cobertura de acentos y por ser la eleccion estandar de la comunidad para drawtext en entornos
  headless sin fontconfig del sistema) -- **dos bugs reales de bundling en Vercel encontrados y
  corregidos en el camino, ninguno de los dos los detecta `next dev`**: (1) Turbopack intentaba
  bundlear el `require()` dinamico de `@ffmpeg-installer/ffmpeg` como si fuera codigo de la app y
  fallaba en build ("Unknown module type" sobre el .exe/README del paquete de plataforma) --
  corregido con `serverExternalPackages` en `next.config.mjs` (le dice a Next que lo deje como
  `require()` real de `node_modules` en runtime, sin bundlearlo); (2) el tracer automatico de
  archivos de Next NO tiene forma de detectar la fuente `.ttf` sola porque se referencia solo por
  ruta de archivo, nunca por un `import` -- se agrego `outputFileTracingIncludes` explicito para esa
  ruta puntual, sin esto el deploy real de Vercel arrancaria sin el archivo y fallaria recien al
  primer uso, no en build. Texto envuelto a mano en varias lineas (ffmpeg no hace word-wrap solo; un
  `onScreenText` de 8-10 palabras al tamaño de fuente elegido se cortaba contra los bordes del video
  vertical de 720px). **Verificado en vivo dos veces**: primero un smoke test local standalone
  (video sintetico generado con ffmpeg, gratis, sin pasar por Veo) para validar el comando exacto de
  ffmpeg y el escapado de rutas antes de integrarlo; despues de punta a punta con Playwright sobre
  la UI/ruta real (subida manual de un video de prueba, escenas reales escritas en el editor,
  click real en el boton real) -- se descargo el video resultante real de Storage y se inspeccionaron
  frames: el texto en español con acentos se ve perfecto, dentro de los margenes, en los tiempos
  correctos. `npm test` (889/889), lint y build sin errores (el build en si fue el que encontro el
  bug de Turbopack de arriba). **Riesgo residual, no verificable desde este entorno**: el bundling
  real en el runtime Linux de Vercel (distinto del `next build` local en Windows) recien queda
  confirmado del todo con el primer uso real en produccion -- si el CI (que corre en Linux) pasa el
  build, es una señal fuerte de que el fix de `serverExternalPackages` generaliza, pero no reemplaza
  probarlo en vivo una vez deployado. Archivos: `src/lib/video-caption.ts`, `src/lib/fonts/
  DejaVuSans-Bold.ttf`, `src/app/api/content/video-caption/`, `next.config.mjs`, `package.json`,
  `src/app/(app)/contenido/instagram/page.tsx`.
- 2026-07-23 (mismo día, cambio COMPLETO de criterio para el video de reels con IA): Seba pidió
  reemplazar por completo el criterio anterior (B-roll cinematográfico de consultorio -- se veía
  "como publicidad genérica de IA") por una **microinfografía médica animada**: estructura fija de
  8 segundos (gancho 0,0-1,2s / 1 a 3 mensajes 1,2-6,2s / CTA 6,2-8,0s), con una regla explícita
  clave: **Veo genera SOLO el fondo/animación (nunca texto, títulos ni interfaces) -- el texto se
  agrega después por edición real** para garantizar ortografía y legibilidad. Trajo un brief
  larguísimo y muy específico (ejemplos exactos de ganchos buenos, frases prohibidas, criterios de
  rechazo, y un formato de entrega con autoevaluación 1-5 en 6 dimensiones, bloqueando la generación
  si alguna da menos de 4).
  - `VIDEO_PROMPT_RULES` (`src/lib/ai.ts`) reescrito de cero: prohíbe explícitamente consultorios
    vacíos, estetoscopios sobre una mesa, médicos caminando por pasillos, dolly-in cinematográfico
    como único recurso, interfaces médicas inventadas, estética de clínica de lujo y rosa como color
    dominante -- pide en cambio una ilustración/motion graphic médico limpio y moderno (ej. un
    corazón animado con una línea de ECG) sobre fondo claro.
  - `VIDEO_BRIEF_RULES` (nuevo): estructura, ejemplos de ganchos buenos vs. frases vacías prohibidas
    (transcriptas casi literal, son muy específicas), contenidos a priorizar, precisión médica,
    criterios de rechazo y la rúbrica de puntaje.
  - `generateVideoBrief()` reemplaza a `generateVideoDirection()` (eliminada, junto con la ruta
    `/api/content/video-direction` y el botón "Proponer dirección con IA"): devuelve gancho,
    video_prompt, objetivo, mensajes, CTA, notas de postproducción/validación y los 6 puntajes en
    una sola llamada. Nueva ruta `/api/content/video-brief`. Nuevos tipos `ContentVideoBrief`/
    `ContentVideoScores`, campo `video_brief?` en `ContentItem` (el gancho reusa `item.hook`, el
    prompt de Veo reusa `item.video_prompt` -- ya existían).
  - `burnVideoBrief()` (nuevo, en `video-caption.ts`, distinto de `burnCaptionsOntoVideo` que sigue
    vigente para el guion filmado a mano -- caso de uso separado): quema gancho/mensajes/CTA con
    tarjetas de texto (fondo claro para gancho/mensajes, tarjeta de acento azul profundo para el
    CTA) y un fundido de entrada/salida suave (expresión `alpha` de ffmpeg en función de `t`,
    construida a mano). `/api/content/video` ahora compone el brief automáticamente sobre el fondo
    que genera Veo en la misma llamada (un solo click, un solo video final) si se le manda
    hook/messages/cta; sin eso, sigue subiendo el fondo solo (compatible con un `video_prompt`
    suelto sin pasar por "Generar propuesta").
  - UI: la tarjeta "Generar con IA (Veo)" se reemplazó por "Microinfografía animada (Veo + texto
    real)" -- botón "Generar propuesta" muestra el brief completo (objetivo, gancho, mensajes, CTA,
    prompt en inglés colapsable, notas) con los 6 puntajes en verde/rojo; el botón "Generar video
    con IA" queda **deshabilitado** si cualquier puntaje da menos de 4/5, con el detalle de qué
    dimensión falló -- gate real, no solo informativo, tal como se pidió explícitamente
    ("No generes el video definitivo si alguna categoría obtiene menos de 4 puntos").
  - **Verificado en vivo (sin gastar cupo de Veo, agotado ese día -- 3/3 generaciones reales ya
    usadas)**: composición de tarjetas con `burnVideoBrief` probada primero con un video sintético
    gratis (mismo patrón que la sesión anterior), y la generación real del brief (solo texto, sin
    Veo) probada de punta a punta con Playwright sobre la UI real -- resultado real: gancho "¿Sentís
    que el corazón se te sale del pecho?", mensajes específicos y no genéricos, CTA "Pedí tu turno
    desde el link de la bio", prompt para Veo "Clean medical motion graphic of a stylized, anatomical
    human heart beating" (alineado con las reglas nuevas). **Pendiente**: verificación end-to-end con
    una generación real de Veo en el estilo nuevo -- requiere esperar al reseteo diario del cupo o
    que Seba autorice subir `DAILY_VIDEO_GENERATION_LIMIT` por un día.
  - `npm test` (889/889), lint y build sin errores (2 errores reales de tipos de TypeScript
    encontrados y corregidos por el build: un `Buffer<ArrayBufferLike>` vs `Buffer<ArrayBuffer>` al
    reasignar la variable tras componer el brief, y un cast directo a `ContentVideoScores` que
    TypeScript no aceptaba por no solapar lo suficiente con `Record<string, number>` -- se construyó
    el objeto de puntajes explícitamente en vez de `Object.fromEntries` + cast).
  - Archivos: `src/lib/ai.ts`, `src/types/index.ts`, `src/lib/video-caption.ts`,
    `src/app/api/content/video/route.ts`, `src/app/api/content/video-brief/` (nueva),
    `src/app/api/content/video-direction/` (eliminada), `src/app/api/content/items/route.ts`,
    `src/app/(app)/contenido/instagram/page.tsx`.

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
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image  # Placas de Instagram (foto) — tiene costo real, ver "Generación de imágenes" abajo
GEMINI_VIDEO_MODEL=veo-3.1-fast-generate-preview  # Video de reels con IA — ver "Video de reels con IA (Veo)" abajo
DAILY_VIDEO_GENERATION_LIMIT=3  # Tope diario, propio y mas estricto que DAILY_AI_REQUEST_LIMIT: tiene costo real por generación
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
# Respaldo opcional de generación de fotos si Gemini falla (cupo agotado, error transitorio) — ver
# "Respaldo opcional con OpenAI" abajo. Sin esto, el comportamiento es igual que antes (solo Gemini).
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2  # Vigente al 2026-07-30 — NO usar "gpt-image-1" (se discontinúa 23/9/2026)
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

### Generación de imágenes (placas de Instagram) — costo real, no es gratis (corregido 2026-07-30)

**Corrección importante**: este documento asumía que generar la placa visual de una pieza (Gemini
Image, `generateContentVisual()` en `src/lib/ai.ts`) era prácticamente gratis, por analogía con el
tier gratuito de texto (`gemini-3.5-flash`, ver arriba). **Eso es incorrecto** — verificado el
2026-07-30 contra el pricing público de Google: `gemini-3.1-flash-image` **no tiene tier gratuito por
API** ("API developers on the free tier cannot generate images with this model"), cuesta entre
~USD 0.045 y USD 0.151 por imagen según resolución (default 1024px ≈ **USD 0.067**). Cada placa que
la app generó hasta ahora (y las que genera hoy con el pipeline de `composeContentPlate()`, ver más
abajo — sigue llamando al mismo modelo de imagen, solo que ahora únicamente para la foto, no para el
texto) tuvo un costo real de ese orden. Esto nunca bloqueó nada porque el proyecto de Google Cloud
detrás de `GEMINI_API_KEY` ya tiene facturación paga activa (lo sabíamos por Veo), pero **nunca se
trackeó como gasto esperado** — recomendado revisar el gasto real acumulado en Google Cloud Console →
Billing, filtrado por "Generative Language API", para tener el número real.

**Costo comparado con OpenAI (gpt-image), para contexto**: en el mismo rango, no hay un proveedor
claramente más barato — `gpt-image-1` (USD 0.011-0.25 según calidad, **se discontinúa el 23/9/2026**,
no usar ese nombre de modelo) y sus sucesores `gpt-image-1.5`/`gpt-image-2` (USD 0.009-0.21) se
solapan con el rango de Gemini. La decisión de sumar OpenAI (ver abajo) es por resiliencia/calidad de
foto, no por ahorro.

### Respaldo opcional con OpenAI (`gpt-image-2`) si Gemini falla (2026-07-30)

A pedido explícito de Seba ("avancemos para que también ChatGPT genere imágenes si lo necesitara"),
`generateContentVisual()` ahora intenta generar la foto con Gemini primero (comportamiento de
siempre) y, **solo si esa llamada falla** (cupo diario agotado — `DAILY_LIMIT_EXCEEDED`, error
transitorio de la API, etc.) **y `OPENAI_API_KEY` está configurada**, cae automáticamente a generar
la misma foto con OpenAI (`gpt-image-2`) en su lugar — mismo patrón que el fallback Gemini→Anthropic
ya existente para texto (`generateText`), aplicado ahora a la generación de fotos. Si `OPENAI_API_KEY`
no está configurada (el caso por default, hoy), el comportamiento es idéntico al de antes: el error
original de Gemini se propaga sin cambios.

- **Variables nuevas**: `OPENAI_API_KEY` (sin esto, el respaldo simplemente no se activa nunca — no
  hace falta "desactivarlo" a propósito). `OPENAI_IMAGE_MODEL` opcional, default `gpt-image-2` — el
  modelo vigente al 2026-07-30, verificado contra la documentación oficial de OpenAI (no se asumió
  `gpt-image-1`, que se discontinúa el 23/9/2026, mismo error que ya se evitó con Sora para video).
- **Requiere verificación de organización en OpenAI**: la documentación oficial exige completar la
  "API Organization Verification" en developer console antes de poder usar los modelos GPT Image — si
  Seba carga `OPENAI_API_KEY` de una organización sin verificar, el fallback va a fallar con un error
  de verificación (no rompe nada, el error original de Gemini sigue siendo el que ve el usuario final
  si ambos proveedores fallan).
- **Sin límite diario propio** (a diferencia de Veo): como solo se activa cuando Gemini ya falló, se
  consideró que no hace falta un segundo sistema de cupo para el volumen de este proyecto (pocas
  piezas por semana) — si el volumen de uso cambiara y esto se volviera un gasto recurrente en vez de
  una excepción, agregar un límite propio (mismo patrón que `DAILY_VIDEO_GENERATION_LIMIT`).
- Las llamadas a OpenAI quedan logueadas en `ai_requests` con `provider: "openai"` (mismo mecanismo
  que Gemini/Anthropic, `logRequest()`), auditable desde ahí sin un dashboard nuevo.
- **No verificado en vivo** (este entorno no tiene `OPENAI_API_KEY`) — la lógica se armó siguiendo la
  documentación oficial de la API de OpenAI (endpoint `POST /v1/images/generations`, parámetros
  `model`/`prompt`/`size`/`quality`/`response_format`), pero falta que Seba cargue una key real (con
  la organización verificada) para confirmar que el fallback funciona de punta a punta. Mientras no
  esté configurada, el comportamiento de la app no cambia en nada respecto a antes.

### Video de reels con IA (Veo) — costo real, sin tier gratuito (2026-07-23)

En el editor de una pieza formato reel, además de subir un video propio, se puede generar el video con
IA (Veo 3.1, vía la misma `GEMINI_API_KEY`) — botones "Proponer dirección con IA" (propone
`video_prompt`, un plano único en inglés) y "Generar video con IA" (`generateContentVideo()` en
`src/lib/ai.ts` → `/api/content/video`). A pedido explícito de Seba, comparado en vivo contra Sora
(OpenAI) antes de elegir: Sora tenía mejor fama de calidad pero **su API se apaga el 24/9/2026 sin
sucesor anunciado** — se descartó por ahora, queda como una eventual "segunda etapa" si hace falta
mejorar calidad más adelante. Veo quedó verificado en vivo con una generación real (clip de 8s
vertical, tier Fast, ~$0.88, 67s de principio a fin) antes de integrarlo al código.

- **Sin tier gratuito** (igual que las placas, ver arriba — la diferencia real es de escala de
  costo, no de "gratis vs. pago"): cada generación exitosa tiene costo real
  (`GEMINI_VIDEO_MODEL=veo-3.1-fast-generate-preview` por default — Fast 720p, ~$0.10-0.12/seg, un
  clip de hasta 8s sale ~$0.80-1, un orden de magnitud más caro que una placa individual). Necesita que el proyecto de Google Cloud detrás de `GEMINI_API_KEY`
  tenga facturación paga activa (a diferencia del resto de la IA de este proyecto) — confirmalo en
  aistudio.google.com → Proyectos → tu proyecto → columna "Nivel de facturación" (tiene que decir un
  nivel pago, no "Nivel gratuito").
- **Límite diario propio y más estricto**: `DAILY_VIDEO_GENERATION_LIMIT` (default 3/día,
  independiente de `DAILY_AI_REQUEST_LIMIT`, ver `getDailyRequestCount(purpose)` con filtro por
  `purpose = "content_video"`) — a diferencia del límite general, pensado para llamadas casi gratis,
  este existe específicamente porque cada intento cuesta plata real.
- **Regla creativa obligatoria, a pedido explícito de Seba**: nunca generar una persona hablando a
  cámara — se nota demasiado que es IA generativa y rompe la confianza que la pieza necesita generar.
  Todo el contenido es B-roll silencioso (manos, objetos, ambientes, equipamiento), mismo criterio que
  ya regía el guion manual de reels (`REEL_SCENE_RULES`) — ver `VIDEO_PROMPT_RULES` en `src/lib/ai.ts`,
  incluye instrucción explícita de audio ("ambient sound only, no dialogue") porque Veo genera audio
  nativo y sin esa aclaración puede inventar voces.
- Es un proceso asíncrono de 1-3 minutos (Veo devuelve una operación de larga duración, se consulta el
  progreso hasta que termina) — la ruta `/api/content/video` queda esperando esa respuesta larga
  (`maxDuration = 280`, la más alta de todo el proyecto) y el botón del editor muestra "Generando...
  puede tardar unos minutos" en vez del spinner casi instantáneo de las placas.
- El video que devuelve Google solo está disponible 48hs en su propia URL — la ruta lo descarga y
  persiste en Storage (`content-media`, mismo bucket que las placas y la subida manual) de una, nunca
  se linkea directo a la URL de Google.

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
automática" con cronograma independiente para Posts, Historias, Carruseles y Reels. La publicación ya
no comparte horario con el mantenimiento: `/api/cron/publish-stories` corre a las 21:00 UTC
(18:00–18:59 ART) y `/api/cron/publish-feed` a las 22:00 UTC (19:00–19:59 ART). Vercel Hobby puede
dispararlos en cualquier minuto de esa hora; la UI muestra la ventana real y no promete un minuto.

1. **Setear `CRON_SECRET`** en las env vars de Vercel (y en `.env.local` si querés probarlo local) — sin
   esto, el endpoint devuelve 401 y no hace nada (falla-cerrado a propósito).
2. Conectar Instagram y Google Business normalmente (como ya se hacía para publicar a mano).
3. En la tarjeta, activar cada formato y elegir sus días. La cantidad de slots es la frecuencia semanal;
   `timezone` queda fijo en `America/Argentina/Buenos_Aires`. Los defaults de agosto quedan preparados
   como Carruseles lunes/domingo, Reel sábado, Post jueves e Historias lunes/martes/jueves/sábado/domingo.
   Los canales son compartidos, pero Google Business no tiene historias, carruseles ni reels.
3.1. Cada track tiene además un control **"Empezar: Ahora / fecha programada"** (`starts_at`). Si se deja
   en "Ahora" (`null`), el comportamiento es el de siempre: en cuanto se activa, publica la primera pieza
   aprobada en la próxima corrida del cron. Si se elige una fecha futura, el cron no publica nada de ese
   track hasta que llegue esa fecha (aunque esté activado y ya haya piezas aprobadas esperando) — recién
   ahí arranca a contar el intervalo de "veces por semana" desde la primera publicación real.
4. Cada track solo auto-publica piezas `aprobadas` de su propio formato. Carruseles requieren portada y
   todas las slides; Reels requieren un video real ya subido. No se generan esos activos de apuro.
5. Además del cron, cada card **aprobada** en Biblioteca tiene un botón **"Publicar ahora"** para publicar
   esa pieza al instante en sus canales asignados, sin esperar al cronograma — útil para piezas puntuales
   o para probar que todo funciona.
6. Si algo falla (token vencido, cuenta desconectada, etc.), la pieza queda con un aviso visible en su
   card ("No se pudo publicar en...") y "Publicar ahora" o los botones manuales del editor sirven para
   reintentar. El texto "Último intento: ..." de cada track explica por qué no se publicó nada en la
   corrida más reciente de ese track.
7. **No hay cambios automáticos de estrategia**: el sistema ejecuta lo configurado y las recomendaciones
   futuras requerirán aprobación manual.
8. **Alerta por email si el cron falla** (2026-07-07) — los tres crons diarios y
   `/api/cron/weekly-report` mandan un email (vía Resend, ver "Alertas de cron por email" abajo) ante
   una excepción no controlada o un error real (no ante estados esperados como `skipped_*` o
   `quota_exceeded`). Por WhatsApp seguiría requiriendo un template aprobado por Meta, así que se
   resolvió por email en su lugar — sin eso configurado, sigue sin avisar nada y hay que revisar la
   tarjeta de Estudio de contenido o los logs de función en Vercel a mano.
9. **Reposición automática de borradores** (2026-08-05) — `/api/cron/auto-draft-content` corre todos
   los días a las 11:00 UTC (8:00 ART, antes de las ventanas de publicación) y genera borradores
   nuevos de post/historia/carrusel cuando el track está activo y se queda sin piezas aprobadas ni
   borradores esperando revisión (ver `src/lib/content-auto-draft.ts`). Quedan como **Borrador en
   Biblioteca** — nunca se auto-aprueban ni se auto-publican, seguís generando placa/revisando/
   aprobando a mano como siempre. No aplica a Reels (requiere generar video con Veo, con costo real y
   su propio gate de revisión humana — no se dispara solo).

## Alertas de cron por email — cómo activarlas (2026-07-07)

Si un cron editorial, `/api/cron/daily-maintenance` o `/api/cron/weekly-report` falla (excepción no controlada, error real
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
1. [x] El template **`alerta_interna_derivacion`** fue reaprobado por Meta el 17/07 después de
   aplicar `20260715_whatsapp_phase0a_safety.sql`. El texto vigente es genérico y usa una sola
   variable (`CASO-XXXXXXXX`); no envía nombre, motivo ni contenido del paciente.
2. [x] Quedó marcado "Aprobado" en `Configuración → Templates de WhatsApp`.
3. [x] `ALERT_WHATSAPP_TO` ya está cargado como variable sensible de Producción, en formato wa.me.
4. Si el template deja de estar aprobado o Meta rechaza el envío, el canal sigue fail-open: no rompe
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
vive en `src/lib/whatsapp-followup.ts` y corre dentro de `/api/cron/daily-maintenance` como respaldo
del worker frecuente de Supabase. También existe `/api/cron/whatsapp-followup` como endpoint standalone
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

## Agenda e ingresos (2026-08-05)

`/planificacion` reemplaza la planilla externa: permite editar y persistir bloques semanales,
aranceles, reglas, feriados y período de proyección, y recalcula carga e ingresos por institución.
No existe conexión ni sincronización con Google Sheets. La configuración vive en la tabla
`practice_planning`, con RLS forzado; `owner` y `doctor` pueden leer y guardar con MFA, validación
de superposiciones y auditoría. Los defaults de `src/lib/practice-planning.ts` sólo sirven como
semilla inicial y la migración nunca reemplaza datos existentes. Alcance: `docs/AGENDA_INGRESOS.md`.

La pantalla es informativa y operativa. No reserva turnos, no confirma disponibilidad y no usa
datos de pacientes ni cobros reales.

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
- **Para cambios no médicos: mergear el PR vos mismo (`gh pr merge --squash --delete-branch`) en
  cuanto CI/build/tests/preview den verde — es el último paso de la tarea, no algo que quede
  pendiente para Seba.** No terminar un resumen de cierre con "revisalo y mergealo cuando
  quieras" ni variantes — eso ya se probó como fricción real más de una vez (ver memoria
  `feedback_merge_autonomy`). Para cambios médicos, el build/tests/preview son necesarios pero no
  reemplazan la aprobación humana previa al merge/deploy.
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
  - Hospital Británico Lanús
  - Hospital Británico Central
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
