# Historial de rendimiento de Instagram

## Qué se guarda

`daily-maintenance` consulta una vez por día cada pieza que tenga `instagram_media_id`. Mantiene el
último valor en `app_config.content_pipeline` por compatibilidad y hace un upsert en
`instagram_media_insight_snapshots`. La clave `(instagram_media_id, capture_date)` evita duplicados
si Vercel reintenta el cron el mismo día argentino; una actualización manual de insights también
actualiza esa misma fila.

Cada publicación nueva registra `published_at` al recibir el `media_id` de Meta. La acción “Marcar
como publicada manualmente” usa el instante de confirmación. La migración fija una aproximación para
piezas anteriores usando `manual_publish_note.marked_at` o, si no existe, el `updated_at` histórico.
Esa aproximación queda congelada y no pretende tener precisión que los datos viejos no ofrecen.

## Métricas verificadas

El 4 de agosto de 2026 se probaron lecturas reales, sin exponer tokens ni IDs, contra piezas de la
cuenta conectada:

| Métrica | Post/carrusel | Reel | Degradación |
|---|---|---|---|
| `reach`, `views`, `likes`, `comments`, `saved`, `shares` | disponibles | disponibles | `null` si Meta no devuelve dato |
| `follows`, `profile_visits` | disponibles según la pieza | rechazadas en el reel probado | `null` |
| `ig_reels_video_view_total_time`, `ig_reels_avg_watch_time`, `reels_skip_rate` | no aplican | disponibles | `null` fuera de reels |

Las historias antiguas probadas respondieron HTTP 200 pero sin valores. Eso se conserva como `null`,
no como cero. Las métricas se piden por separado: el rechazo de una no tapa las demás ni detiene el
resto del mantenimiento. `raw_metrics_json` guarda únicamente el cuerpo de métricas devuelto por
Meta, separado por nombre; no guarda URLs, headers, tokens ni credenciales.

Referencia vigente: colección oficial de Meta en Postman,
[Media Insights](https://www.postman.com/meta/instagram/request/23987686-0089d9e0-6141-4f69-a967-9d4c1c277ec9).

## Ventanas comparables

La Biblioteca muestra el snapshot más cercano a 24 h, 72 h y 7 días desde `published_at`. Como el
cron es diario, se acepta una tolerancia de ±18 horas. Si no hay una fila dentro de ese rango se
muestra “Todavía sin snapshot comparable”; si la fila existe pero una métrica no está habilitada se
muestra “no disponible”. No se extrapola ni se transforma una ausencia en cero.

Una republicación evergreen recibe un `instagram_media_id` y `published_at` nuevos. La UI compara
solo las filas del media actual; el historial anterior permanece en la tabla para una futura vista
de repeticiones, sin mezclarse con la publicación vigente.

## Operación y rollback

- Migración: `20260804_instagram_media_insight_snapshots.sql`.
- Variables nuevas: ninguna.
- Cron nuevo: ninguno; se reutiliza `/api/cron/daily-maintenance`.
- Retención: indefinida por ahora; el volumen diario esperado es pequeño y no contiene PII.

Para rollback de código, revertir el PR mantiene la tabla sin consumidores y no afecta publicación,
colas ni los últimos insights guardados en `app_config`. No borrar la tabla durante un rollback: es
datos históricos recuperables. Si hiciera falta desactivar la captura sin revertir todo, quitar solo
la llamada a `snapshotContentInsights` de `daily-maintenance` y desplegar por PR.
