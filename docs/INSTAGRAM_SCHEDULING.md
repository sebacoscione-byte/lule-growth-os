# Cronograma editorial de Instagram

## Arquitectura

La publicación editorial está separada del mantenimiento técnico:

| Ruta | Cron UTC | Ventana ART | Responsabilidad |
|---|---:|---:|---|
| `/api/cron/daily-maintenance` | `30 10 * * *` | 07:30–08:29 | WhatsApp, alertas, seguidores, insights y Google Business |
| `/api/cron/publish-stories` | `0 21 * * *` | 18:00–18:59 | Solo historias elegibles |
| `/api/cron/publish-feed` | `0 22 * * *` | 19:00–19:59 | Posts, carruseles y reels elegibles |
| `/api/cron/weekly-report` | `0 8 * * 0` | domingo 05:00–05:59 | Reporte semanal existente |

Vercel interpreta los cron en UTC. En Hobby cada job puede ejecutarse como máximo una vez por día
y puede dispararse en cualquier minuto de la hora configurada. Por eso la interfaz informa ventanas,
no un minuto exacto.

## Configuración

`app_config.auto_publish_settings` conserva un track por formato. Cada track usa:

```ts
{
  enabled: boolean
  timezone: "America/Argentina/Buenos_Aires"
  schedule_slots: Array<{ day_of_week: number; local_time: string }>
  items_per_run: number
  starts_at: string | null
  last_published_at: string | null
  last_run_at: string | null
  last_run_result: string | null
}
```

La frecuencia semanal es la cantidad de slots; no existe un segundo contador que pueda quedar
inconsistente. La API valida duplicados, zona horaria, horarios soportados y superposiciones entre
posts, carruseles y reels. Las historias sí pueden anticipar una pieza principal la misma noche.

La forma legacy con `times_per_week` y `days_of_week` se convierte al leerla. Se preservan activación,
días, fecha de inicio, tamaño de tanda y últimos resultados; las colas y `queue_rank` viven en las
piezas y no se modifican.

## Cadencia inicial recomendada

- Carruseles: lunes y domingo, 19:00–20:00 ART.
- Reels: sábado, 19:00–20:00 ART.
- Posts estáticos: jueves, 19:00–20:00 ART.
- Historias: lunes, martes, jueves, sábado y domingo, 18:00–19:00 ART.

Los defaults quedan preparados pero desactivados para instalaciones nuevas. En una cuenta existente,
el owner puede aplicar la estrategia desde `Estudio de contenido → Biblioteca` sin alterar la cola.

## Idempotencia y degradación

- Un track no vuelve a publicar si `last_published_at` corresponde al mismo día argentino.
- Antes de cada pieza se relee la cola; una pieza que ya dejó de estar aprobada no se publica.
- Los canales ya exitosos se excluyen de un reintento parcial.
- Un feed legacy con noches superpuestas publica como máximo un formato esa noche y registra
  `skipped_feed_conflict` en los restantes.
- Carruseles incompletos y reels sin video se omiten con un error visible; no se publica material roto.
- Un fallo de una métrica o integración de mantenimiento no cancela las publicaciones editoriales.

## Configuración en Vercel

No hay variables nuevas. Después del deploy, verificar en `Project → Settings → Cron Jobs` que las
cuatro rutas de `vercel.json` estén activas y que `CRON_SECRET` siga configurado en Production.

## Rollback

Revertir el commit restaura `/api/cron/publish-content` y el `vercel.json` anterior. Vercel advierte
que un Instant Rollback no actualiza automáticamente los cron activos; para un rollback operativo hay
que redeployar el commit revertido o actualizar/deshabilitar manualmente los jobs en el dashboard.
La configuración JSON nueva no elimina piezas ni colas, pero el código anterior espera
`days_of_week`: antes de volver a ese commit hay que transformar cada `schedule_slots[].day_of_week`
a `days_of_week` y guardar su cantidad como `times_per_week`, o desplegar primero un commit puente que
acepte ambas formas. No hacer un Instant Rollback ciego después de que producción haya guardado el
modelo canónico.
