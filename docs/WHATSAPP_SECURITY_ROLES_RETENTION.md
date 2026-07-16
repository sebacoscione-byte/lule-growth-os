# Seguridad de acceso, auditoría y retención de WhatsApp

## Estado de despliegue

La implementación está en código y en la migración
`20260716_whatsapp_privacy_roles_retention.sql`, pero la migración no fue aplicada y los controles
de rol/MFA no fueron activados. No se agregó un cron: la limpieza se ejecuta dentro de
`weekly-report`, uno de los dos cron jobs existentes.

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

1C persiste un checkpoint cuando termina el handler para que un fallo del ACK no reprocese la
respuesta al paciente. 1D unifica la identidad lead/conversación, hace routing y handoff atómicos,
aplica CAS al despacho y reconcilia IDs de proveedor duplicados antes de exigir unicidad. 1E
coordina borrado con workers/outbox mediante advisory locks y tombstones HMAC.

Los tests de migraciones actuales son contratos estáticos sobre el texto SQL y tests de integración
con mocks. No aplican estas funciones a PostgreSQL real ni prueban interleavings concurrentes. Antes
de producción hay que ejecutar todo el lote, en orden, sobre una copia/staging con backup; revisar
las reconciliaciones de duplicados de 1D y probar carreras entre cola, outbox, handoff y borrado.

## Roles y permisos

El rol se lee exclusivamente de `auth.users.raw_app_meta_data.role`, expuesto en el JWT como
`app_metadata.role`. Nunca se usa `user_metadata`, porque el usuario puede modificarlo. La matriz
siguiente describe el estado objetivo una vez activados los flags; mientras `enforce_roles=false`,
una cuenta histórica sin rol conserva compatibilidad equivalente a `owner`, y un rol explícito sí
se respeta.

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

El acceso a leads/conversaciones y las operaciones sensibles (envío manual, handoff,
pausa/reactivación, corrección, exportación, borrado y cambio de configuración) requieren `aal2`
cuando se activa MFA. Los mismos límites se repiten en las políticas RLS para evitar que un cliente
autenticado eluda las rutas HTTP.

## Activación segura (dependencia externa)

La migración crea `security_authorization_settings` con ambos flags en `false`, para no bloquear de
golpe a las cuentas existentes. Antes de activarlos:

1. Inventariar todos los usuarios de Supabase Auth y asignar un rol válido en `app_metadata.role`
   mediante Admin API/Dashboard con credenciales de servidor.
2. Enrolar MFA para quienes necesiten ejecutar operaciones sensibles y comprobar que su sesión
   alcanza `aal2`.
3. Ejecutar el gate de staging descrito arriba, aplicar las migraciones y probar al menos una cuenta
   por rol, incluidos rechazos esperados y RLS desde un cliente autenticado.
4. Configurar en Supabase Cron/`pg_net` una llamada por minuto a
   `POST /api/internal/whatsapp-worker`, con URL y `CRON_SECRET` guardados en Vault. Esto es
   configuración externa posterior al deploy; no se agrega un tercer cron de Vercel.
5. Con `service_role`, activar primero roles y luego MFA (o ambos en una ventana controlada):

```sql
update security_authorization_settings
set enforce_roles = true,
    require_mfa_for_sensitive_actions = true,
    updated_at = now()
where id = 'global';
```

No se agregó una ruta web para cambiar estos flags: solo `service_role` puede hacerlo. Si falta la
tabla o su fila global, o si la configuración no puede leerse, las rutas fallan cerradas. El modo
compatible requiere la fila explícita con ambos flags en `false`, por lo que el código y la
migración deben desplegarse juntos.

Antes de activar respuestas reales también hay que definir `META_GRAPH_API_VERSION`, revisar y
guardar como verificadas las tres sedes y su configuración operativa, y confirmar que
`shadow=false`, `canary=false` y las cohortes siguen en 0. El template interno
`alerta_interna_derivacion` fue reducido a un texto genérico con una sola variable (ID opaco de
caso); 0A lo deja en borrador y Meta debe reaprobar esa versión antes de usar el aviso por WhatsApp.

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
