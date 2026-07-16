# Material para revisión legal — Política de privacidad y datos de salud

**Para quién es esto:** Seba, para mandarle esto (o un resumen) a un asesor legal antes de sacar
el aviso de "borrador" de `/privacidad`. No reemplaza la lectura del texto completo de la política
— es un resumen para orientar la revisión y dejar explícitas las preguntas concretas que necesitan
una respuesta de un abogado, no de un desarrollador.

**Por qué hace falta esta revisión:** la app procesa datos administrativos vinculados con atención
de salud (teléfono, cobertura, servicio y sede) y puede recibir espontáneamente texto clínico de
pacientes reales de la Dra. Lucía Chahin, aunque el bot no lo solicite ni lo incorpore al intake.
Eso exige un estándar de cuidado más alto que un sitio comercial común — de ahí que el texto de
`/privacidad` esté marcado como borrador hasta que alguien con criterio legal lo confirme.

---

## 1. Qué hace la app, en una oración

Un sistema de captación de pacientes: recibe contactos por WhatsApp o por la web pública, ayuda a
clasificar el motivo de consulta, y deriva al paciente a la sede correcta (CIMEL Lanús, Hospital
Británico o Swiss Medical Lomas) para que pida turno ahí — **la app en sí no da turnos, no
diagnostica, no interpreta estudios**.

## 2. Dónde está el texto completo a revisar

`https://draluciachahin.ar/privacidad` (código fuente: `src/app/privacidad/page.tsx`). Describe,
en lenguaje llano:
- Qué datos se recolectan (contacto, categoría administrativa, obra social, sede, contenido
  administrativo posterior al consentimiento y navegación agregada del sitio). El bot no pide
  edad, síntomas ni estudios.
- Para qué se usan (contactar, derivar a la sede correcta, clasificar automáticamente el motivo).
- Con qué terceros se comparten (ver punto 3).
- Cuánto tiempo se conservan (ver punto 4 — propuesta técnica ampliada localmente, todavía sin
  despliegue ni aprobación legal).
- Cómo pedir acceso, corrección o eliminación (hoy manual, por WhatsApp).

## 3. Terceros que reciben datos

| Proveedor | Qué recibe | Para qué | ¿Procesa fuera de Argentina? |
|---|---|---|---|
| Meta (WhatsApp Business Platform) | Mensajes de WhatsApp completos | Enviar/recibir mensajes | Sí (EE.UU./infraestructura global de Meta) |
| Anthropic (Claude) y/o Google (Gemini) | Sólo texto administrativo mínimo cuando hace falta clasificación; el contenido clínico detectado se filtra antes | Devolver una categoría cerrada; no redactan la respuesta al paciente | Sí (EE.UU.) |
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

## 4. Política de retención (ampliada localmente 2026-07-16, sin desplegar)

Propuesta técnica implementada localmente, todavía sin desplegar y sujeta a revisión legal:

- **Leads que nunca se convirtieron en pacientes, o con solo datos administrativos**: se
  anonimizan/eliminan automáticamente tras **24 meses de inactividad**.
- **Datos vinculados con protocolo de investigación clínica**: **no se eliminan automáticamente**
  mientras se define el plazo legal aplicable. Tras 24 meses de inactividad se bloquea su uso para
  contacto comercial, pero el dato permanece bajo una retención especial.
- **Datos técnicos de WhatsApp**: eventos procesados 30 días, dead letter 90 días, evaluaciones
  shadow/estados de entrega/ledger finalizado 180 días y auditoría de seguridad 24 meses.
- **Supresión posterior al borrado**: se conserva por 90 días un seudónimo HMAC no reversible en la
  práctica sin su clave local, no el teléfono ni el ID de Meta. Se sigue tratando como dato personal
  protegido. El teléfono bloquea escrituras genéricas durante 15 minutos y los eventos viejos se
  siguen rechazando según su `occurred_at`; los IDs estables de evento/salida se bloquean durante
  los 90 días.
- **Registro de solicitudes de borrado (`data_erasure_log`)**: queda seudonimizado como evidencia,
  pero todavía no tiene un plazo de eliminación automática definido.
- Cualquier paciente puede pedir el borrado manual en cualquier momento, sin esperar estos plazos
  (ver `docs/BACKLOG.md` → DATA-02 para el detalle técnico completo).

**Pregunta para el abogado**: ¿los plazos técnicos propuestos —incluidos los 90 días de tombstone
HMAC— son razonables/defendibles para este tipo de dato en Argentina, qué plazo corresponde a datos
vinculados con protocolos y cuánto tiempo debe conservarse `data_erasure_log` como prueba de haber
atendido la solicitud, considerando que esta app no almacena una historia clínica completa?

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

Antes de registrar el contenido administrativo, el bot muestra este texto y exige el botón o una
aceptación positiva inequívoca. Los consentimientos legacy no habilitan el flujo:

> "Para orientarte sobre cómo pedir turno, necesitamos registrar tu número, cobertura, sede elegida
> y motivo administrativo de contacto. No usamos este canal para diagnóstico ni para recibir
> estudios. Podés consultar la política de privacidad en [URL]. ¿Aceptás que tratemos esos datos
> para responder esta consulta?"

Si el paciente contesta algo como "no acepto"/"no quiero"/"no autorizo", no se registra nada y se
lo aclara explícitamente. Queda guardado (fecha, versión del texto, si aceptó o no) en
`consent_records` — ver `src/lib/whatsapp-consent.ts`.

**Pregunta para el abogado**: ¿este texto alcanza para tratar los datos administrativos indicados y
recibir una consulta por un canal de salud, o hace falta mencionar de otro modo los datos sensibles
enviados espontáneamente, los terceros o el derecho a retirar el consentimiento?

## 7. Menores de edad — el bot no pide edad, pero falta una decisión legal

El intake administrativo ya no pregunta ni extrae edad. Sin embargo, una persona menor podría
escribir por iniciativa propia y **no hay una lógica específica para identificar ese caso o pedir
que continúe un adulto responsable**. Es una decisión pendiente, no una autorización implícita.

**Pregunta para el abogado**: ¿hace falta algún tratamiento especial (aviso, derivación directa a
un adulto responsable, restricción de qué se pregunta) cuando la edad informada es menor a 18
años, tratándose de datos de salud por WhatsApp? Si la respuesta es sí, es una decisión de
producto que hay que diseñar aparte — no algo para resolver solo en el texto de `/privacidad`.

## 8. Lo que la app garantiza no hacer (guardrails ya implementados, no depende de esta revisión)

- No da diagnósticos ni interpreta estudios.
- No confirma turnos ni disponibilidad.
- No usa los datos de salud para ningún fin comercial ni los publica.
- Ante una señal de alarma determinística, indica buscar atención inmediata en una guardia o llamar
  al servicio de emergencias de la zona, sin esperar por WhatsApp. La IA no redacta ese texto.
- Las respuestas visibles del bot salen de textos fijos; el modelo solo puede devolver categorías
  validadas y su salida no se usa para dar diagnóstico, tratamiento o interpretación clínica.

## 9. Qué falta después de esta revisión

1. Confirmar o ajustar el texto de `/privacidad` según la respuesta del abogado a las preguntas de
   los puntos 3, 4, 5, 6 y 7.
2. Si corresponde, decidir y diseñar un tratamiento especial para menores de edad (punto 7) —
   requiere una decisión de producto, no solo de texto legal.
3. Sacar el aviso de "borrador" de la página una vez confirmado.
4. Si corresponde, cargar `https://draluciachahin.ar/privacidad` como Privacy Policy URL en el
   Meta Developer Console (solo urgente si se saca la app de Instagram del modo desarrollo).
5. Reaprobar en Meta `alerta_interna_derivacion`: la versión endurecida es genérica, usa una sola
   variable con un ID opaco de caso y no incluye nombre, teléfono, síntoma ni motivo. La migración
   la deja en borrador hasta completar esa aprobación.

## 10. Estado técnico previo a producción (para no confundir código con despliegue)

Los cambios siguen locales y no se aplicaron a la base. El orden obligatorio es 0A → 0B → 1 → 1B
→ 1C → 1D → 1E → policy → privacy, correspondiente a:

1. `20260715_whatsapp_phase0a_safety.sql`.
2. `20260716_whatsapp_phase0b_operations.sql`.
3. `20260716_whatsapp_phase1_durable_transport.sql`.
4. `20260716_whatsapp_phase1b_outbound_ledger.sql`.
5. `20260716_whatsapp_phase1c_queue_checkpoint.sql`.
6. `20260716_whatsapp_phase1d_atomic_routing.sql`.
7. `20260716_whatsapp_phase1e_erasure_suppression.sql`.
8. `20260716_whatsapp_policy_shadow.sql`.
9. `20260716_whatsapp_privacy_roles_retention.sql`.

Las pruebas SQL existentes validan contratos estáticos y mocks; no ejecutan el lote sobre
PostgreSQL real. Antes de producción hacen falta staging/backup, revisión de duplicados históricos,
pruebas concurrentes de cola/outbox/borrado, roles en `app_metadata`, enrolamiento MFA, una cuenta
probada por rol, versión de Meta configurada y sedes/configuración operativa verificadas. Estos son
gates técnicos separados de la aprobación médica y de esta revisión legal.
