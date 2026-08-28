# Confiabilidad de crons

## Arquitectura

Los cinco procesos programados tienen dos disparadores independientes y una única ejecución lógica:

1. Vercel Cron conserva el horario primario declarado en `vercel.json`.
2. Supabase `pg_cron` llama al mismo endpoint a los minutos 40, 45, 50 y 55 de la hora.
3. `cron_run_ledger` reclama atómicamente `job_name + fecha argentina` antes de ejecutar negocio.

Si Vercel ya terminó, los cuatro llamados de respaldo responden `skipped_completed`. Si Vercel sigue
corriendo, responden `skipped_running`. Si falló o venció su lease, el siguiente llamado reclama un
nuevo intento. El lease dura 240 segundos, por encima de los 180 segundos máximos de las funciones y
por debajo de los cinco minutos entre respaldos.

| Tarea | Vercel UTC | Ventana ART | Respaldo Supabase UTC |
| --- | --- | --- | --- |
| `daily-maintenance` | `30 10 * * *` | 07:00–07:59 | 10:40, 10:45, 10:50, 10:55 |
| `auto-draft-content` | `0 11 * * *` | 08:00–08:59 | 11:40, 11:45, 11:50, 11:55 |
| `publish-stories` | `0 21 * * *` | 18:00–18:59 | 21:40, 21:45, 21:50, 21:55 |
| `publish-feed` | `0 22 * * *` | 19:00–19:59 | 22:40, 22:45, 22:50, 22:55 |
| `weekly-report` | `0 8 * * 0` | domingo 05:00–05:59 | 08:40, 08:45, 08:50, 08:55 |

El worker durable de WhatsApp no usa este ledger: mantiene su job independiente cada minuto y sus
propios leases, checkpoints, outbox y cuarentena.

## Estados y reintentos

- `running`: lease activo; otro disparador no entra.
- `succeeded`: terminó; no se vuelve a ejecutar esa fecha.
- `warning`: condición no recuperable dentro de la misma ventana, como cuota diaria agotada; alerta
  pero no gasta más intentos.
- `failed`: fallo transitorio; el siguiente respaldo puede reclamarlo inmediatamente.

Los endpoints devuelven HTTP 500 en `failed`, en vez del HTTP 200 ambiguo anterior. Las alertas se
envían en el primer fallo; los reintentos posteriores no generan cuatro correos iguales. La tabla y
sus RPC están forzadas a RLS y sólo `service_role` puede leerlas o ejecutarlas.

## Idempotencia de efectos

- Publicación: el ledger evita concurrencia; una corrida parcial puede retomar únicamente piezas que
  siguen pendientes. Una pieza ya persistida como publicada no vuelve a ser candidata.
- Borradores: se persisten de a uno, para que un timeout no pierda todo el lote; el retry recalcula lo
  que falta.
- Snapshots y reporte semanal: usan upsert por día/semana.
- Retención y WhatsApp: conservan sus RPC, claims, tombstones y delivery keys existentes.
- Recordatorio de handoff: usa una clave de idempotencia diaria al enviar por Resend.

## Operación

Validación sin cambios:

```bash
npm run migrate -- --dry-run --from=20260828_cron_run_ledger.sql
npm run configure:cron-recovery
npm run configure:cron-recovery -- --verify-only
```

Aplicación, después de desplegar el código:

```bash
npm run migrate -- --atomic --from=20260828_cron_run_ledger.sql
npm run configure:cron-recovery -- --apply
```

El configurador usa parámetros para guardar URL y `CRON_SECRET` en Supabase Vault. Ningún valor
sensible queda dentro de `cron.job`, logs o archivos versionados.
