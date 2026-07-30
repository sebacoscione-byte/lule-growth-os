# Log de sesión — 2026-07-30 · Texto mal en las placas + revisión de cómo generamos imágenes

> Este archivo es la transcripción de una sesión de Claude Code corrida en la nube (web/mobile),
> guardada acá para poder leerla desde otra sesión (ej. la PC). Rama de trabajo:
> `claude/image-text-generation-bug-d3k1h7`. PR **#178** hacia `main`.
> Es un log temporal — se puede borrar una vez leído/mergeado si molesta en el repo.

---

## Turno 1 — Seba: "se están generando mal los textos de las imágenes. algo se rompió." (con captura)

**Captura:** placa de "SÍNTOMAS DE ALARMA EN MUJER" abierta en la app (dominio draluciachahin.ar).
El título salía bien y el subtítulo también ("El corazón no siempre avisa de la misma manera"), pero
en el medio aparecía una **tercera línea inventada y deforme**: *"Professional medel acardiojogist
del agottrita"*. El campo "Titular de la placa" decía "SINTOMAS DE ALARMA EN LA MUJER" (con "LA"),
pero la imagen mostraba "SINTOMAS DE ALARMA EN MUJER" (se comió el "LA").

**Diagnóstico (investigado antes de tocar código):**
- El texto de las placas lo renderiza el **propio modelo de imagen de Gemini**
  (`gemini-3.1-flash-image`), quemado dentro de la imagen — no lo componemos nosotros aparte.
- La línea deforme es una alucinación clásica: el modelo agarra palabras descriptivas de la
  dirección creativa (que va en inglés, tipo "professional medical cardiologist office…") y las
  dibuja como si fueran un texto más de la placa.
- Se verificó por git que en el repo **no cambió nada** relevante: el modelo de imagen y el endpoint
  (`.../v1/models/…:generateContent`) vienen del PR #126 sin cambios; el prompt de render de
  `generateContentVisual` se tocó por última vez en #175 (solo la zona segura de reels); la parte de
  texto de `IMAGE_PROMPT_RULES` está estable. O sea, el "algo se rompió" vino **de afuera del
  código**.

**Pregunta a Seba (3 opciones):** (A) quemar el texto nosotros, (B) reforzar el prompt, (C) primero
revisar el modelo en Vercel. **Seba eligió: "Reforzar el prompt".** Y agregó: *"antes había salido
una imagen que decía alama en vez de alarma"* (o sea, el modelo también escribe mal el propio
titular, no solo alucina la línea extra).

**Fix aplicado** en `generateContentVisual` (`src/lib/ai.ts`): whitelist explícito de que el ÚNICO
texto permitido son el titular y el subtítulo, render carácter por carácter con acentos/ñ sin
traducir/abreviar/reordenar/comerse palabras (con "LA" y "ALARMA"/"ALAMA" como ejemplos),
prohibición explícita de bylines/credenciales/palabras en inglés/lettering inventado, aclaración de
que la CREATIVE DIRECTION describe la escena y sus palabras nunca deben aparecer como texto, y un
FINAL CHECK de cierre.

**Verificación:** `npm test` (893/893), lint y build sin errores. NO verificable en vivo (el entorno
en la nube no tiene `GEMINI_API_KEY`). Commit `7534421`, pusheado a la rama. No se abrió PR (todavía).

---

## Turno 2 — Seba: "hacé una revisión sobre Vercel y todo para entender si cambió algo"

No hay integración de Vercel en la sesión de la nube (no se puede leer el dashboard ni sus env vars),
así que se revisó todo lo que sí se deploya, por historial de git:

| Pieza | Último cambio | ¿Cambió hace poco? |
|---|---|---|
| Modelo de imagen (`gemini-3.1-flash-image`) | #126 (18-jul) | ❌ constante |
| Endpoint de Gemini (`.../v1/models/…`) | #126 | ❌ |
| Prompt de render (`generateContentVisual`) | #175 (28-jul) | ⚠️ solo zona segura de reels |
| `IMAGE_PROMPT_RULES` | 19-jul (Holter/MAPA/eco/femenina) | ❌ nada de texto |
| `vercel.json` / crons | — | ❌ |
| HEAD de `main` | #177 (29-jul) | sin commits sorpresa |

**Conclusión:** en el repo no cambió nada que explique la regresión. Causas posibles, todas fuera del
código: (1) `GEMINI_IMAGE_MODEL` cambiado en Vercel (lo más fácil de revertir), (2) Google degradó el
modelo, (3) varianza del modelo (no determinístico — por eso "alama" salió una vez y no siempre).

**Qué tiene que mirar Seba en Vercel (no se puede desde la nube):**
1. Settings → Environment Variables → `GEMINI_IMAGE_MODEL`: confirmar que dice `gemini-3.1-flash-image`.
   Si quedó apuntando a otro modelo, o cargada como "Sensitive" con un valor raro (ya pasó con
   `GEMINI_MODEL`, que tenía una API key adentro — ver nota del 15-jul en CLAUDE.md), ese es el
   culpable y revertirla es el fix instantáneo.
2. Confirmar que `GEMINI_API_KEY` no haya quedado pisada.
3. Deployments: correlacionar la línea de tiempo — ¿hubo un deploy o edición de env var justo antes
   de que empezaran a salir mal las placas?

---

## Turno 3 — Seba: "sumá al backlog esta revisión para poder hacerlo luego desde la PC"

Se agregó a `docs/BACKLOG.md` la entrada **`[DESDE LA PC]` Verificar `GEMINI_IMAGE_MODEL` en Vercel**
con el checklist de arriba + la mitigación ya mergeada. Commit `af4fd16`.

---

## Turno 4 — Seba: "sumá también revisar cómo generamos las imágenes, porque me gustó esto que generé con ChatGPT" (con captura) + "sumá a backlog que quiero que veamos si vale la pena sumar generación de imágenes con ChatGPT"

**Captura (placa de ChatGPT):** muchísimo mejor. Texto perfecto con acentos, "EN LA MUJER" en color
bordo, "corazón" en negrita en el subtítulo. **Identidad de marca real:** logo de hoja arriba-izq,
logo corazón-estetoscopio con "DRA. LUCÍA CHAHÍN / CARDIOLOGÍA", ícono de latido, panel de texto
crema a la izquierda + foto (mujer con la mano en el pecho) a la derecha + onda turquesa de pie.

Se guardó la referencia en `docs/assets/placa-referencia-chatgpt-2026-07-30.png` y se agregó al
backlog la entrada **`[DECISIÓN + REVISIÓN]`** con el análisis y dos caminos:
- **Opción A — Plantilla de marca + texto quemado por nosotros** (cambio estructural, el más
  confiable, agnóstico del proveedor): la IA genera solo la foto/escena; el titular, subtítulo,
  logos, onda y colores los compone nuestro código sobre una plantilla fija (SVG/`sharp`/canvas, o el
  stack ffmpeg/DejaVu de `burnVideoBrief`). Garantiza texto perfecto e identidad de marca consistente.
- **Opción B — Sumar OpenAI `gpt-image-1`** (el pedido explícito): renderiza texto mucho mejor que
  Gemini, pero tiene costo (sin tier gratis), nueva API key, y aun así generar texto+layout en una
  pasada sigue siendo menos confiable que la Opción A.
- **Recomendación preliminar:** la referencia se ve así de bien sobre todo por el layout de marca +
  texto nítido, no solo por "mejor IA" → la Opción A da el mayor salto; la B es complemento.

Commit `e3a840e`.

---

## Turno 5 — Seba: "decime qué prompt compartirle a ChatGPT para que te pase cómo decidió generar esa imagen"

Se le dio a Seba un prompt para pegarle a ChatGPT (junto con la imagen) pidiendo: si el texto lo
renderizó el modelo o lo compuso como capa aparte; paleta HEX; tipografías; layout/proporciones;
elementos de marca; el prompt de la foto; y cómo lo pensaría como plantilla reutilizable. El punto
clave era saber si ChatGPT **compone el texto como capa** (lo que reforzaría la Opción A).

---

## Turno 6 — Seba pegó la respuesta de ChatGPT (verbatim, resumido)

Puntos clave de lo que respondió ChatGPT:
- **Todo salió en UNA sola imagen**: foto, título, subtítulo, "DRA. LUCÍA CHAHÍN", "CARDIOLOGÍA",
  hoja, corazón-estetoscopio, ícono de latido, ondas. **No hubo capas editables, ni tipografías
  reales superpuestas, ni logos prediseñados, ni composición posterior.** El texto lo dibujó el
  propio modelo como píxeles — "se ve bastante correcto pero no mantiene kerning/interlineado/tamaño
  exactos" y **no es reproducible de forma determinista**.
- El llamado técnico fue con `prompt: null` — la herramienta armó la instrucción sola a partir del
  pedido original, la **captura del feed**, la crítica a la primera imagen y el contexto del
  proyecto. No hay un prompt manual copiable.
- **El formato real era 1:1**, no 4:5.
- El salto de estilo (de "infografía médica azul" a "editorial, femenina, cálida, fotográfica,
  premium, coherente con el feed") vino **de pasarle una captura del feed existente como referencia**.
- **ChatGPT recomienda por su cuenta exactamente la Opción A**: (1) foto por IA sin texto, (2)
  plantilla fija editable con título/subtítulo/marca/íconos/ondas, (3) assets vectoriales fijos, (4)
  paleta y tipografías definidas a mano. Es la única forma de mantener layout/letras/logos/posiciones
  consistentes entre publicaciones.

Se incorporó todo al backlog (commit `5e146c5`). Conclusión afinada: Opción A = camino recomendado
(ahora respaldado también por ChatGPT); Opción B = opcional/complementaria, por sí sola no garantiza
el texto.

---

## Turno 7 — Seba: "¿algo más para consultarle a ChatGPT?"

Se le dio a Seba un segundo prompt para pedirle a ChatGPT **entregables concretos** para prototipar
la Opción A: paleta HEX exacta, tipografías libres (Google Fonts) con pesos y jerarquía, los 3
íconos de marca como **SVG real** (hoja, corazón-estetoscopio, latido), la onda como SVG, una **foto
sin texto** en 1:1 con espacio negativo a la izquierda, un prompt de foto reutilizable, y la spec de
layout 1:1 (coordenadas/márgenes).

---

## Turno 8 — Seba: "entrego esto" (con imagen)

**Imagen:** la foto sin texto en 1:1 (mujer con las manos en el pecho, interior cálido, espacio
negativo limpio a la izquierda, sin letras ni logos). Es el primer asset usable para la plantilla.
Se guardó en `docs/assets/foto-sin-texto-sintomas-mujer-1x1.png` y se marcó como recibida en el
checklist del backlog. Commit `90d99d6`.

**Assets que todavía faltan pedir a ChatGPT** (checklist en el backlog):
- [ ] SVGs de los 3 íconos (hoja, corazón-estetoscopio, latido) — los más importantes.
- [ ] SVG de la onda inferior.
- [ ] Paleta HEX exacta (crema, verde petróleo, bordo/coral, turquesa, gris texto).
- [ ] Tipografías libres (serif editorial + sans, con pesos y jerarquía).
- [ ] Prompt de foto reutilizable (inglés, con espacio negativo a la izquierda).
- [ ] Spec de layout 1:1 (coordenadas/márgenes en 1080×1080).

---

## Turno 9-11 — Cierre de sesión y PR

- Se registraron los aprendizajes en `CLAUDE.md` → "Estado actual" (entrada 2026-07-30). Commit
  `d8ff914`. **Lección**: cuando el texto de una placa sale mal y el código de generación no cambió,
  revisar primero las env vars del deploy (`GEMINI_*` en Vercel) antes de asumir un bug de código.
- Seba pidió abrir el PR → se creó **PR #178** hacia `main`. Se actualizó la línea de CLAUDE.md para
  reflejarlo (commit `6e4e369`).

---

## Estado final / pendientes para la PC

1. **Revisar y mergear el PR #178** (el fix del texto llega a producción recién ahí). Si se puede,
   mirar una placa regenerada después del deploy (no se pudo verificar en vivo desde la nube).
2. **Chequear `GEMINI_IMAGE_MODEL`/`GEMINI_API_KEY` en Vercel** — causa más probable del "algo se
   rompió" y fix instantáneo si quedó mal. Ver checklist en `docs/BACKLOG.md` → `[DESDE LA PC]`.
3. **Decidir el alcance de la Opción A** (plantilla propia) y pedirle a ChatGPT los assets que
   faltan (SVGs, paleta, tipografías, prompt de foto, spec de layout). Con eso, armar la plantilla
   concreta y un primer render de prueba.

**Commits de la sesión** (rama `claude/image-text-generation-bug-d3k1h7`):
`7534421` (fix del prompt) · `af4fd16` · `e3a840e` · `5e146c5` · `90d99d6` · `d8ff914` · `6e4e369`
(+ el commit de este log).
