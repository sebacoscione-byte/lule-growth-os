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

| Proveedor | Qué recibe | Para qué | ¿Procesa fuera de Argentina? |
|---|---|---|---|
| Meta (WhatsApp Business Platform) | Mensajes de WhatsApp completos | Enviar/recibir mensajes | Sí (EE.UU./infraestructura global de Meta) |
| Anthropic (Claude) y/o Google (Gemini) | El texto del mensaje del paciente | Clasificar el motivo de consulta, sugerir respuestas — no toman decisiones médicas | Sí (EE.UU.) |
| Supabase | Toda la base de datos de la app | Almacenamiento | Sí (el proyecto usa una región de EE.UU./AWS) |
| Vercel | — (aloja la app) | Hosting | Sí (EE.UU./red global) |
| Google Analytics (opcional, opt-in) | Navegación agregada, sin nombre/teléfono | Medir visitas | Sí (EE.UU.) |

**Pregunta para el abogado (aviso de terceros)**: ¿esta lista y estas descripciones alcanzan como
aviso de terceros bajo la Ley 25.326 de Protección de Datos Personales, considerando que se trata
de datos de salud?

**Pregunta para el abogado (transferencia internacional)**: la Ley 25.326 (art. 12) restringe
transferir datos personales a países que no tengan un nivel de protección "adecuado" — y **los 5
proveedores de arriba procesan datos fuera de Argentina**. ¿Hace falta una cláusula específica de
transferencia internacional en `/privacidad`, o algún mecanismo adicional (ej. cláusulas
contractuales tipo) para que esto sea válido tratándose de datos de salud?

**Pregunta para el abogado (acuerdos de tratamiento de datos)**: ¿conviene que Seba consiga y
guarde un Data Processing Agreement (DPA) firmado o aceptado de cada proveedor (Meta, Anthropic,
Google, Supabase, Vercel) — la mayoría los ofrece como parte de sus términos estándar — o alcanza
con la descripción de `/privacidad` sin un documento adicional por proveedor?

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

## 6. Texto de consentimiento en el primer contacto por WhatsApp

Antes de registrar cualquier dato, el bot le muestra este texto exacto al paciente y espera que
conteste que sí (o continúa si ya había aceptado antes):

> "Para ayudarte, podemos registrar tus datos de contacto, cobertura médica y motivo de consulta.
> No reemplaza una consulta médica. ¿Aceptás continuar?"

Si el paciente contesta algo como "no acepto"/"no quiero"/"no autorizo", no se registra nada y se
lo aclara explícitamente. Queda guardado (fecha, versión del texto, si aceptó o no) en
`consent_records` — ver `src/lib/whatsapp-consent.ts`.

**Pregunta para el abogado**: ¿este texto alcanza como consentimiento informado válido para
recolectar datos de salud (motivo de consulta), o hace falta un texto más específico (ej.
mencionar explícitamente "datos de salud", los terceros involucrados, o el derecho a retirar el
consentimiento en cualquier momento)?

## 7. Menores de edad — hoy sin ningún tratamiento especial

El bot pregunta la edad del paciente como parte de la conversación (para saber si aplica algún
criterio clínico), pero **no hay ninguna lógica distinta si la persona que escribe es menor de
edad** — ni un aviso adicional, ni un pedido de que sea un adulto responsable quien continúe la
conversación. Es una laguna real, no una decisión tomada a propósito.

**Pregunta para el abogado**: ¿hace falta algún tratamiento especial (aviso, derivación directa a
un adulto responsable, restricción de qué se pregunta) cuando la edad informada es menor a 18
años, tratándose de datos de salud por WhatsApp? Si la respuesta es sí, es una decisión de
producto que hay que diseñar aparte — no algo para resolver solo en el texto de `/privacidad`.

## 8. Lo que la app garantiza no hacer (guardrails ya implementados, no depende de esta revisión)

- No da diagnósticos ni interpreta estudios.
- No confirma turnos ni disponibilidad.
- No usa los datos de salud para ningún fin comercial ni los publica.
- Ante un síntoma de alarma, siempre deriva a que el paciente llame al **107 (SAME)** o vaya a una
  guardia (lógica determinística en `src/lib/medical-safety.ts`, no depende de IA). *Corregido el
  2026-07-12: el bot decía 911 en este mensaje puntual mientras el resto del sitio ya decía 107 —
  quedaron unificados en 107, el número del sistema de emergencias médicas de CABA y provincia de
  Buenos Aires, donde están las 3 sedes.*

## 9. Qué falta después de esta revisión

1. Confirmar o ajustar el texto de `/privacidad` según la respuesta del abogado a las preguntas de
   los puntos 3, 4, 5, 6 y 7.
2. Si corresponde, decidir y diseñar un tratamiento especial para menores de edad (punto 7) —
   requiere una decisión de producto, no solo de texto legal.
3. Sacar el aviso de "borrador" de la página una vez confirmado.
4. Si corresponde, cargar `https://draluciachahin.ar/privacidad` como Privacy Policy URL en el
   Meta Developer Console (solo urgente si se saca la app de Instagram del modo desarrollo).
