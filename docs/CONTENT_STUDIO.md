# Estudio de contenido

## Flujo

1. Elegir categoria, formato y CTA. El tema es opcional.
2. Buscar informacion reciente cuando el contenido mencione novedades o datos clinicos.
3. Seleccionar una fuente visible o continuar sin fuente para contenido evergreen.
4. Generar una propuesta completa con IA.
5. Revisar y editar hook, caption, hashtags, slides y texto de Google.
6. Generar la placa final con Gemini desde el editor y descargarla.
7. Aprobar el borrador. A partir de ahi, publicar a mano (copiar a Instagram o publicar en Google
   Business) o dejar que la publicacion automatica lo haga sola cada N dias — ver seccion "Publicacion
   automatica" mas abajo.

El brief queda listo cuando tiene categoria. Si el tema o enfoque queda vacio, la IA elige de forma autonoma el angulo mas atractivo, util y concreto dentro de esa categoria. La biblioteca permite buscar por tema, categoria o hook y filtrar por estado y formato.

## Fuentes

La busqueda usa Europe PMC y prioriza revisiones y metaanalisis publicados desde 2024 hasta la fecha actual. La fuente elegida queda guardada con el borrador y visible durante la revision.

La IA recibe el titulo, publicacion, fecha y resumen disponible. No debe inventar resultados que no aparezcan en ese contexto ni convertirlos en consejo medico.

## Persistencia

Los borradores se guardan en la clave `content_pipeline` de `app_config`. Esto permite usar el flujo sin ejecutar una migracion adicional. Se conservan hasta 100 piezas.

Estados:

- `draft`: generado y pendiente de revision.
- `approved`: revisado y aprobado por una persona.
- `published`: publicado en todos los canales pedidos (Instagram y/o Google Business), a mano o automatico.
- `archived`: retirado de la biblioteca activa.

La revision humana guarda todos los campos editables de la pieza. Para aprobar se requieren hook, caption y titular visual (la historia no necesita hook/caption, Instagram no los muestra); el carrusel ademas exige que la portada y cada slide tengan su propia imagen generada (ver seccion "Carruseles" mas abajo). Si se edita una pieza aprobada o publicada, vuelve a borrador para requerir una nueva revision.

## Imagenes con Gemini

Cada pieza nueva incluye:

- `image_prompt`: direccion creativa en ingles decidida por la IA.
- `image_alt_text`: descripcion breve en espanol para accesibilidad.
- `visual_headline` y `visual_subtitle`: textos que Gemini integra en la placa final.

El prompt visual define una sola direccion creativa, proporcion vertical, punto focal, composicion, luz, color, jerarquia tipografica y zonas seguras. Pide una pieza editorial legible en pantalla chica y prohibe logos, marcas de agua, texto extra, collages, gradientes genericos y cliches medicos.

El editor llama a Gemini Image para generar una placa final 4:5 para feed/carrusel o 9:16 para historia. La persona revisa el resultado y lo descarga; no tiene que armar la composicion visual.

Variables:

- `GEMINI_IMAGE_MODEL`: modelo de imagen; por defecto `gemini-3.1-flash-image`.

La generacion automatica de placas requiere cuota disponible para modelos de imagen en la clave de Gemini. Algunas claves tienen limite gratuito `0`; en ese caso la app muestra el enlace para revisar cuota o activar billing en lugar de un error generico.

## Criterio de captacion

Cada pieza debe cumplir una secuencia:

1. Detener el scroll con un hook y una imagen que se entiendan rapido.
2. Generar identificacion con una duda, situacion cotidiana o aspiracion reconocible.
3. Entregar valor real antes de pedir una accion.
4. Facilitar un proximo paso simple para considerar una consulta por canales oficiales.

La captacion no puede usar miedo, culpa, escasez, promesas ni asumir que el lector tiene una condicion. El editor muestra este checklist antes de aprobar.

## Canales

- Instagram: generacion y descarga de placa con Gemini y copia del texto listo para publicar. La
  publicacion directa por API (manual o automatica) soporta `post`, `historia` y `carrusel`. El reel
  sigue sin soporte: requiere video real y la app solo genera imagenes estaticas — usar "Copiar
  Instagram" para publicarlo a mano.
- Google Business: publicacion desde la app solo para contenido aprobado y cuando Google habilita la API para la cuenta. Solo texto (`google_text`), sin imagen.

## Carruseles (2026-07-11)

A diferencia de post/historia (una sola placa), un carrusel necesita una imagen propia por cada slide
ademas de la portada:

- El editor tiene una tarjeta "Placas de cada slide" (visible solo para `format === "carrusel"`) con un
  boton para generar todas las imagenes de una sola vez o de a una por slide. Todas reusan la misma
  direccion visual (`image_prompt`) de la portada, solo cambia el titular/texto que se renderiza en cada
  imagen — no hay un sistema de plantillas separado, cada imagen es una generacion independiente de
  Gemini (no hay garantia de continuidad visual perfecta entre slides, es una limitacion conocida de
  generar cada imagen por separado).
- Se pueden agregar o quitar slides a mano (boton "Agregar slide", maximo 9 + portada = 10, el limite
  real de Instagram) — util tanto para ajustar lo que genero la IA como para armar un carrusel 100% manual
  desde "Crear pieza en blanco".
- **Aprobar un carrusel exige que la portada y cada slide tengan su propia imagen generada** (`/api/content/items`
  PATCH lo valida server-side, no solo en la UI) — a diferencia de post/historia, que pueden aprobarse
  solo con el titular de texto. Esto evita publicar despues un carrusel a medio armar.
- Publicacion: `publishCarouselToInstagram` en `src/lib/instagram-business.ts` crea un contenedor hijo
  por imagen (`is_carousel_item: true`), espera a que cada uno termine de procesar, arma el contenedor
  padre (`media_type: CAROUSEL`) y publica. Requiere minimo 2 imagenes (portada + 1 slide), maximo 10.

## Publicacion automatica

Ademas del boton manual "Publicar en Instagram"/"Publicar en Google" y de "Publicar ahora" (publica una
pieza aprobada al instante, sin esperar cronograma), las piezas `approved` con formato `post`, `historia`
o `carrusel` pueden publicarse solas via un Vercel Cron diario (`vercel.json` → `/api/cron/publish-content`,
protegido por la env var `CRON_SECRET`, ver `CLAUDE.md`).

- **Tres cronogramas independientes**: `app_config.auto_publish_settings` tiene `channels` (compartido) y
  tres sub-objetos `post`/`historia`/`carrusel`, cada uno con `enabled`, `times_per_week`, `last_published_at`,
  `last_run_at`, `last_run_result`. Se editan por separado desde la tarjeta "Publicacion automatica" en
  `Estudio de contenido → Biblioteca`. Motivo: no conviene mezclar la cadencia de posts de feed con la de
  historias ni con la de carruseles (referencia de investigacion sobre cadencia en cuentas de salud: no
  publicar todos los dias; carrusel por default arranca en 1 vez por semana, es la pieza mas pesada de
  producir). El tercer track corre dentro del mismo cron job, no suma un cron nuevo de Vercel (el plan
  Hobby sigue limitado a 2, ver `CLAUDE.md`).
- Cada cronograma elige, dentro de su propio formato, la pieza aprobada mas antigua (por `approved_at`) —
  el reel queda siempre pendiente de accion manual, nunca bloquea ninguna cola.
- A diferencia de post/historia (que generan la placa "de apuro" en el cron si todavia no existe), el
  track de carrusel **nunca genera imagenes dentro del cron** — como la aprobacion ya exige que todas
  esten listas de antes, si alguna falta simplemente se salta esa pieza con un error en vez de publicar
  un carrusel incompleto.
- Publica por canal de forma independiente: si Instagram sale bien pero Google falla (o viceversa), la
  pieza queda en `approved` con `auto_publish_result` marcando que canal fallo, visible como aviso en su
  card. Solo pasa a `published` cuando **todos** los canales pedidos salieron bien. Google Business no
  tiene concepto de "historia" ni de "carrusel", asi que las piezas de esos formatos solo se tagean con
  canal `instagram`.
- Si se agota la cuota diaria de IA (`DAILY_AI_REQUEST_LIMIT`) antes de generar la placa, el cron lo trata
  como evento esperado (`quota_exceeded`) y reintenta al dia siguiente, sin marcar error en la pieza.
- La logica de negocio (cuando corresponde correr cada track, que pieza elegir, que canales resolver) vive
  en `src/lib/content-pipeline.ts` como funciones puras testeadas (`content-pipeline.test.ts`); la
  publicacion por canal compartida entre el cron y "Publicar ahora" vive en `src/lib/content-publish.ts`.

### Repetir una pieza fija (evergreen) — on/off + limite (2026-07-19)

Cada pieza `approved`/`published` tiene en su editor un interruptor **"Repetir esta pieza automaticamente"**
(antes era un campo "repetir cada X dias", cambiado a on/off porque los dias ya los decide el cronograma del
track — tener ambas cosas se pisaba). Los campos viven en el JSON de la pieza (`app_config`, sin migracion):

- `repeat_interval_days`: al prender el interruptor se guarda `1` = "elegible en cada corrida programada".
  Que dias y cuantas veces por semana sale lo controla enteramente el cronograma del track (post/historia/
  carrusel), no la pieza. Apagado = `null` (se publica una sola vez, comportamiento de siempre). Valores `>1`
  son legado (cadencia propia en dias desde `updated_at`); `isRepeatDue` los sigue respetando.
- `repeat_limit` (opcional): tope de repeticiones automaticas. Vacio/`null` = sin limite (se repite hasta
  apagarlo). Al alcanzarlo, `isRepeatDue` deja de darla por vencida y la pieza no vuelve a salir sola.
- `repeat_count`: cuantas veces la republico el cron. Lo maneja **solo el sistema** (se incrementa en el cron
  al republicar con exito; no cuenta un fallo transitorio) y se resetea a 0 al re-activar el interruptor
  (off→on, server-side en `/api/content/items`). No es editable por el cliente.
- Las piezas que se repiten **no compiten por el cupo `items_per_run`** ("Publicar de a N"): ese cupo limita
  solo las piezas nuevas aprobadas, y las evergreen vencidas se publican **además** en la misma corrida
  (`pickNextPublishableItems` = `[...aprobadas.slice(0, count), ...evergreenVencidas]`). Ej: con "Publicar de a
  1" y una pieza fija marcada para repetirse, cada día programado salen 2 publicaciones — la nueva del cupo y
  la fija aparte. Una pieza fija nunca le quita el lugar a una nueva ni al revés.
- **Limitacion de plataforma**: los reposteos van por la API de Instagram, que nunca permite sticker de link
  en historias. Si el link tiene que estar (ir a la web, etc.), va escrito o como QR dentro de la imagen. Para
  mandar a Historias Destacadas no hace falta link: la placa indica "toca mi perfil" y la persona entra sola.

## Guardrails

Todo contenido debe evitar diagnosticos, tratamientos, interpretacion de estudios, promesas y mensajes que asuman una condicion medica del lector. Los sintomas de alarma deben derivarse a guardia o atencion medica inmediata.

Estos guardrails se muestran dentro del editor antes de aprobar una pieza.

## Proveedor e idioma

El estudio usa la capa comun de IA de la app. Se puede seleccionar Google Gemini o Anthropic con `AI_PROVIDER`, y todas las propuestas se solicitan explicitamente en espanol.

Con `AI_PROVIDER=auto`, Gemini tiene prioridad cuando `GEMINI_API_KEY` esta configurada. Si un proveedor no tiene saldo o alcanza su cuota, la interfaz muestra un mensaje breve y accionable en lugar del error tecnico de la API.

En modo manual, el pegado intenta reparar automaticamente comillas internas sin escapar y saltos de linea que algunos modelos devuelven dentro de campos JSON.

El ingreso directo no exige completar el brief. Si categoria o tema estan vacios, la app usa el titular visual o el hook para nombrar la pieza y la guarda bajo la categoria `Contenido generado`.
