# Seguridad de acceso, auditoría y retención de WhatsApp

## Estado de despliegue

La implementación del PR #96 está activa en producción. Las nueve migraciones iniciales se aplicaron
en una única transacción; el hotfix posterior de `search_path` dejó 10/10 aplicadas. El PR #97 también está productivo: dejó
activos el scheduler durable, el audit agregado y el preflight cerrado de Meta. La limpieza de
retención sigue dentro de `weekly-report`, uno de los dos cron jobs de Vercel; el worker usa aparte
Supabase Cron y no consume un tercer slot.

Los controles de rol/MFA están activos en producción. El audit final encontró una cuenta `owner` y
una `doctor`, ambas con MFA verificado; las otras dos cuentas permanecen deliberadamente sin rol y
quedan bloqueadas. `enforce_roles` se activó y auditó antes de activar
`require_mfa_for_sensitive_actions`; ambos flags están en `true`.

El orden obligatorio del lote es:

1. `20260715_whatsapp_phase0a_safety.sql` (0A).
2. `20260716_whatsapp_phase0b_operations.sql` (0B).
3. `20260716_whatsapp_phase1_durable_transport.sql` (1).
4. `20260716_whatsapp_phase1b_outbound_ledger.sql` (1B).
5. `20260716_whatsapp_phase1c_queue_checkpoint.sql` (1C).
6. `20260716_whatsapp_phase1d_atomic_routing.sql` (1D).
7. `20260716_whatsapp_phase1e_erasure_suppression.sql` (1E).
8. `20260716_whatsapp_policy_shadow.sql` (policy).
9. `20260716_whatsapp_privacy_roles_retention.sql` (privacy).
10. `20260716_whatsapp_security_pgcrypto_search_path.sql` (pgcrypto en `extensions`).

1C persiste un checkpoint cuando termina el handler para que un fallo del ACK no reprocese la
respuesta al paciente. 1D unifica la identidad lead/conversación, hace routing y handoff atómicos,
aplica CAS al despacho y reconcilia IDs de proveedor duplicados antes de exigir unicidad. 1E
coordina borrado con workers/outbox mediante advisory locks y tombstones HMAC.

El límite clínico no cambia con este cierre: WhatsApp nunca usa un modelo para redactar respuestas
médicas libres. La IA sólo puede producir enums validados; guardrails, derivaciones y mensajes al
paciente salen de reglas y catálogos determinísticos.

Los tests de migraciones son contratos estáticos sobre el texto SQL y tests de integración con
mocks. El lote además pasó un dry-run con rollback y luego se aplicó atómicamente sobre PostgreSQL
de producción. Eso valida SQL y dependencias, pero no prueba interleavings concurrentes: sigue
faltando una copia/staging para revisar carreras entre cola, outbox, handoff y borrado y ensayar una
restauración aislada.

## Roles y permisos

El rol se lee exclusivamente de `auth.users.raw_app_meta_data.role`, expuesto en el JWT como
`app_metadata.role`. Nunca se usa `user_metadata`, porque el usuario puede modificarlo. La matriz
siguiente describe el estado productivo con los flags activos. Una cuenta sin rol ya no conserva
compatibilidad histórica y queda bloqueada.

| Rol | Datos identificables | Inbox / envío manual / handoff | Exportar | Borrar | Leer config | Cambiar config |
| --- | --- | --- | --- | --- | --- | --- |
| `owner` | Sí | Sí | Sí | Sí | Sí | Sí |
| `doctor` | Sí | Sí | Sí | Sí | Sí | No |
| `reception` | Sí | Sí | No | No | No | No |
| `research` | No | No | No | No | No | No |
| `viewer` | No | No | No | No | No | No |

`research` queda deliberadamente sin acceso a las tablas identificables. Si se necesita análisis de
investigación, debe exponerse una vista agregada/desidentificada específica; no corresponde abrirle
el CRM completo.

`app_config` tiene además una whitelist por clave: el navegador sólo puede consultar
`doctor`, `locations`, `whatsapp_settings`, `auto_publish_settings` y `content_pipeline`. Tokens,
refresh tokens e IDs de integraciones Google/Instagram quedan exclusivamente bajo `service_role`.
`app_config_history` también es backend-only y el trigger nunca copia claves fuera de esa whitelist.

El acceso server-side pasa por una fuente única de rol y política; las rutas internas que leen o
mutan datos/configuración también llaman al autorizador explícito. El callback de autenticación
acepta únicamente orígenes confiables y un destino interno normalizado para evitar redirects
abiertos. Al activar MFA, el gate central exige `aal2` **antes de entrar a cualquier pantalla del
CRM**, no sólo al mutar: las políticas RLS protegen también las lecturas de datos identificables.
Las rutas sensibles vuelven a comprobar rol/AAL para que un cliente no pueda eludir el gate web.

## Activación segura (dependencia externa)

La migración creó `security_authorization_settings` con ambos flags en `false`, para no bloquear de
golpe a las cuentas existentes. La activación productiva completó este orden:

1. Inventariar las cuatro cuentas actuales y asignar a cada una un rol válido en
   `app_metadata.role` mediante Supabase Admin API/Dashboard; no inferir roles por email.
2. Con los flags todavía apagados, hacer que cada persona enrole y verifique al menos un factor TOTP.
   El respaldo para `owner` fue recomendado; el responsable decidió operar sin segundo factor y
   aceptó que la pérdida del único autenticador requiere recuperación administrativa.
3. Probar un login fresco y el step-up de cada cuenta. Verificar también el procedimiento de
   recuperación descrito abajo antes de depender de MFA en producción.
4. Activar **sólo roles** con `service_role` y validar accesos/rechazos de al menos una cuenta por rol,
   incluidos RLS y las rutas internas:

```sql
update security_authorization_settings
set enforce_roles = true,
    updated_at = now()
where id = 'global';
```

5. Después de validar roles y confirmar que todas las cuentas necesarias conservan acceso, activar
   MFA en una segunda operación:

```sql
update security_authorization_settings
set require_mfa_for_sensitive_actions = true,
    updated_at = now()
where id = 'global';
```

6. Cerrar las sesiones de prueba, iniciar sesión de nuevo y confirmar que AAL1 no puede entrar al
   CRM, que AAL2 sí puede y que RLS rechaza lecturas PII desde una sesión que no cumple la política.

No existe una ruta web para cambiar estos flags: sólo `service_role` puede hacerlo. Si falta la
tabla/fila global o no puede leerse, el sistema falla cerrado. El estado productivo actual requiere
la fila explícita con ambos flags en `true`.

### Enrolamiento, factores de respaldo y recuperación

La pantalla central permite enrolar TOTP, resolver el challenge de login y administrar varios
factores verificados. La clave/QR sólo se muestra durante el enrolamiento en el navegador: nunca se
debe imprimir, registrar ni copiar a tickets. Un segundo factor para `owner` sigue recomendado,
pero el responsable decidió no configurarlo.

No hay endpoint público de recuperación ni se implementaron códigos de respaldo. Si una persona
pierde todos sus factores:

1. verificar su identidad fuera de banda con el procedimiento operativo acordado;
2. un administrador autorizado elimina el factor desde Supabase Admin/Dashboard, sin compartir
   emails, IDs, QR o secretos por logs/tickets;
3. la persona inicia sesión y enrola un factor nuevo;
4. se prueba un login fresco antes de dar el incidente por cerrado.

Cambiar la contraseña no elimina el segundo factor y no reemplaza este procedimiento.

El estado productivo puede revisarse sin mostrar PII ni secretos con:

```bash
node scripts/audit-whatsapp-production.mjs
node scripts/audit-whatsapp-production.mjs --with-meta
```

`--with-meta` agrega el preflight autenticado de producción; su salida sigue limitada a HTTP,
`ok` y un enum cerrado, sin token ni identificadores.

La configuración del worker es idempotente. Sin argumentos valida en una transacción y hace
rollback; `--apply` persiste extensiones, secretos Vault y el único job, y luego prueba el endpoint:

```bash
node scripts/configure-whatsapp-worker.mjs
node scripts/configure-whatsapp-worker.mjs --apply
```

Vercel Production fija `META_GRAPH_API_VERSION=v25.0`. El preflight read-only comprueba
versión/token/ID sin enviar mensajes ni devolver credenciales o identificadores; el cron diario
alerta con un código cerrado si falla. La confirmación individual de
sedes: cada ubicación conserva evidencia propia, usa control de versión y se actualiza
atómicamente; modificar una no verifica ni pisa las demás. El audit productivo muestra CIMEL Lanús,
Hospital Británico y Swiss Medical Lomas activas y con evidencia individual vigente. El runtime
falla cerrado si una versión futura pierde esa evidencia.
También debe confirmar que `shadow=false`, `canary=false` y las cohortes siguen en 0. El template interno
`alerta_interna_derivacion` fue reducido a un texto genérico con una sola variable (ID opaco de
caso); figura `pendiente_meta` y debe ser aprobado antes de usar el aviso por WhatsApp.

## Auditoría sin PII ni contenido de pacientes

`security_audit_log` es accesible solo con `service_role`. Conserva el UUID interno del operador
para trazabilidad, pero no nombre, email, teléfono ni contenido del paciente. Registra:

- UUID interno del operador y su rol;
- acción y tipo de recurso mediante enums cerrados;
- seudónimo SHA-256 del identificador del recurso, nunca el ID crudo;
- metadata administrativa validada, sin campos de nombre, teléfono, email, mensaje, contenido ni
  resumen.

Los flujos auditados son envío manual, acciones de handoff, pausa/reactivación, exportación,
corrección, borrado y cambio de configuración. Las rutas registran la intención antes de mutar o
exportar; si la auditoría no está disponible, la operación sensible no continúa.

El log histórico de borrado también migra de UUID/email crudos a hashes. Los nuevos handoffs usan el
UUID del operador, no su email.

Los hashes SHA-256 de teléfono usados por cola, rollout y ledger son **seudónimos deterministas**,
no datos anónimos ni cifrado: un actor que conozca el espacio posible de teléfonos podría compararlos
por diccionario. Por eso siguen bajo `service_role` y tienen retención limitada.

El borrado agrega tombstones HMAC con una clave aleatoria local a la base, inaccesible incluso para
clientes autenticados. El HMAC del teléfono se conserva 90 días, pero bloquea escrituras genéricas
por teléfono sólo durante 15 minutos. En eventos de cola se compara además `occurred_at`: aunque
haya vencido esa ventana corta, un redelivery cuyo timestamp sea anterior o igual al borrado se
suprime durante los 90 días. Los identificadores estables de evento y salida también se tombstonean
90 días. Esto evita conservar el teléfono/ID en claro y, a la vez, permite que la misma persona
inicie una conversación genuinamente nueva después de la ventana de coordinación.

## Derechos sobre los datos

- **Acceso/exportación:** CSV autenticado, limitado a `owner`/`doctor` y AAL2 al activar MFA.
- **Corrección:** `PATCH /api/leads/[id]`, limitado a personal asistencial/recepción y auditado.
- **Borrado:** operación atómica `erase_lead`; elimina además eventos de cola, leases, estados de
  entrega y evaluaciones shadow vinculables a la conversación.
- **Oposición/opt-out:** el bot procesa las frases de baja de forma determinista, corta el contacto
  y conserva la evidencia mínima de consentimiento/revocación según la política vigente.
- **Limitación de uso:** los registros clínicos/de protocolo vencidos no se borran automáticamente;
  quedan con `consent_to_contact=false` y `retention_hold=true`.

La solicitud de una persona sigue requiriendo verificación humana de identidad; no existe un portal
público de autoservicio para exportar o borrar datos.

## Retención operativa

| Dato | Plazo | Acción |
| --- | ---: | --- |
| Eventos de cola procesados | 30 días | Borrado |
| Dead letter sin contenido crudo | 90 días | Borrado |
| Evaluaciones shadow/canary | 180 días | Borrado |
| Eventos de estado de entrega | 180 días | Borrado |
| Ledger de envíos finalizados | 180 días | Borrado |
| Auditoría de seguridad | 24 meses | Borrado |
| Eventos de costo WhatsApp | 24 meses | Borrado |
| Sesiones sin lead | 30 días | Borrado |
| Consentimientos sin lead | 24 meses | Se elimina teléfono/evidencia; queda decisión no vinculable |
| Leases vencidos | 1 día adicional | Borrado |
| Leads administrativos inactivos | 24 meses | Borrado atómico |
| Datos de protocolo/investigación | Sin borrado automático | Bloqueo de uso comercial |
| Tombstones HMAC de teléfono/evento/salida | 90 días | Borrado; teléfono bloquea genéricamente 15 min |
| `data_erasure_log` seudonimizado | Pendiente de criterio legal | Sin borrado automático definido |

El plazo de 180 días elimina el historial técnico de `whatsapp_message_status_events`. Los campos
materializados de estado en `messages` y `whatsapp_cost_events` viven con su registro padre y se
eliminan o anonimizan mediante la política aplicable a ese registro.

Los errores de la barrida son códigos cerrados (`retention_*`, `operational_cleanup_failed`): no
incluyen UUID de leads, teléfonos ni mensajes de Postgres en la respuesta o alerta del cron.

La ausencia de plazo para `data_erasure_log` es deliberadamente un gate, no una retención infinita
aprobada: el registro puede ser necesario como prueba de que se atendió un derecho, pero el plazo
defendible debe resolverlo el asesor legal antes de cerrar la política de producción.
