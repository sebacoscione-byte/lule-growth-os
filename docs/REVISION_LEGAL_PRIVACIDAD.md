# Material para revisión legal — Política de privacidad y datos de salud

**Para quién es esto:** Seba, para mandarle esto (o un resumen) a un asesor legal antes de sacar
el aviso de "borrador" de `/privacidad`. No reemplaza la lectura del texto completo de la política
— es un resumen para orientar la revisión y dejar explícitas las preguntas concretas que necesitan
una respuesta de un abogado, no de un desarrollador.

**Por qué hace falta esta revisión:** la app procesa datos de salud (motivo de consulta, síntomas,
edad, obra social) de pacientes reales de la Dra. Lucía Chahin. Eso la sujeta a un estándar de
cuidado más alto que un sitio comercial común — de ahí que el texto de `/privacidad` esté marcado
como borrador hasta que alguien con criterio legal lo confirme.

---

## 1. Qué hace la app, en una oración

Un sistema de captación de pacientes: recibe contactos por WhatsApp o por la web pública, ayuda a
clasificar el motivo de consulta, y deriva al paciente a la sede correcta (CIMEL Lanús, Hospital
Británico o Swiss Medical Lomas) para que pida turno ahí — **la app en sí no da turnos, no
diagnostica, no interpreta estudios**.

## 2. Dónde está el texto completo a revisar

`https://draluciachahin.ar/privacidad` (código fuente: `src/app/privacidad/page.tsx`). Describe,
en lenguaje llano:
- Qué datos se recolectan (contacto, motivo de consulta, edad, obra social, contenido de
  WhatsApp, navegación agregada del sitio).
- Para qué se usan (contactar, derivar a la sede correcta, clasificar automáticamente el motivo).
- Con qué terceros se comparten (ver punto 3).
- Cuánto tiempo se conservan (ver punto 4 — política implementada el 2026-07-12).
- Cómo pedir acceso, corrección o eliminación (hoy manual, por WhatsApp).

## 3. Terceros que reciben datos

| Proveedor | Qué recibe | Para qué |
|---|---|---|
| Meta (WhatsApp Business Platform) | Mensajes de WhatsApp completos | Enviar/recibir mensajes |
| Anthropic (Claude) y/o Google (Gemini) | El texto del mensaje del paciente | Clasificar el motivo de consulta, sugerir respuestas — no toman decisiones médicas |
| Supabase | Toda la base de datos de la app | Almacenamiento |
| Vercel | — (aloja la app) | Hosting |
| Google Analytics (opcional, opt-in) | Navegación agregada, sin nombre/teléfono | Medir visitas |

**Pregunta para el abogado**: ¿esta lista y estas descripciones alcanzan como aviso de terceros
bajo la normativa aplicable (Ley 25.326 de Protección de Datos Personales + cualquier
consideración especial por tratarse de datos de salud), o falta algo (ej. cláusulas de
transferencia internacional, dado que varios de estos proveedores procesan datos fuera de
Argentina)?

## 4. Política de retención (implementada 2026-07-12, DATA-02)

Definida por Seba, ya implementada en código:

- **Leads que nunca se convirtieron en pacientes, o con solo datos administrativos**: se
  anonimizan/eliminan automáticamente tras **24 meses de inactividad**.
- **Datos de participación en un protocolo de investigación clínica**: **nunca se eliminan
  automáticamente** — se conservan por el plazo legal aplicable, con un piso de **10 años** desde
  la última actuación registrada. Tras 24 meses de inactividad se deja de usarlos para contactar
  al paciente (no más mensajes comerciales), pero el dato permanece intacto.
- Cualquier paciente puede pedir el borrado manual en cualquier momento, sin esperar estos plazos
  (ver `docs/BACKLOG.md` → DATA-02 para el detalle técnico completo).

**Pregunta para el abogado**: ¿los plazos de 24 meses y 10 años son razonables/defendibles para
este tipo de dato en Argentina, o hay una normativa específica (ej. de historias clínicas, aunque
esta app no almacena historias clínicas completas) que sugiera otro plazo?

## 5. Consentimiento de analítica (DATA-03)

Hoy Google Analytics **no se carga hasta que el visitante acepta explícitamente** un banner de
consentimiento (opt-in) — es el default más conservador posible, elegido a propósito mientras no
hubiera una confirmación legal de si hacía falta. GA4 nunca recibe nombre, teléfono ni el
contenido de la consulta, solo navegación agregada.

**Pregunta para el abogado**: para esta audiencia (pacientes/visitantes buscando un cardiólogo en
Argentina), ¿es necesario pedir consentimiento explícito para analítica agregada y anónima como
la de Google Analytics, o alcanzaría con un aviso informativo sin bloquear la carga? Si la
respuesta es "no hace falta pedir consentimiento", se puede relajar el opt-in actual — mientras
tanto se mantiene la versión más cuidadosa.

## 6. Lo que la app garantiza no hacer (guardrails ya implementados, no depende de esta revisión)

- No da diagnósticos ni interpreta estudios.
- No confirma turnos ni disponibilidad.
- No usa los datos de salud para ningún fin comercial ni los publica.
- Ante un síntoma de alarma, siempre deriva a que el paciente llame al 107 o vaya a una guardia
  (lógica determinística en `src/lib/medical-safety.ts`, no depende de IA).

## 7. Qué falta después de esta revisión

1. Confirmar o ajustar el texto de `/privacidad` según la respuesta del abogado a las preguntas de
   los puntos 3-5.
2. Sacar el aviso de "borrador" de la página una vez confirmado.
3. Si corresponde, cargar `https://draluciachahin.ar/privacidad` como Privacy Policy URL en el
   Meta Developer Console (solo urgente si se saca la app de Instagram del modo desarrollo).
