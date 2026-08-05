# Atribución y aprendizaje de Instagram

## Cadena comprobable

El link `/api/content/track/[itemId]` abre la landing con `utm_content=<itemId>`. Cuando el CTA de
WhatsApp apunta al bot, el mensaje prellenado conserva dos dimensiones visibles y editables:

- `Contenido: <itemId>` identifica la pieza;
- `Ref: <código>` identifica landing y sede del CTA.

El bot guarda sólo esos identificadores opacos antes del consentimiento. No guarda el texto libre del
paciente por esta función. `whatsapp_sessions.content_item_id` prueba que una conversación llegó al
sistema. Al crear el lead con consentimiento, `leads.utm_content` conserva la pieza,
`leads.referral_code` conserva el código y `content_origin_location_key` conserva la sede del CTA.
`content_attributed_at` fija el instante del primer contacto y no se desplaza con mensajes posteriores.
Un trigger copia sólo sesión anónima, pieza, referencia, sede e instante a
`instagram_content_conversations`, para no perder una atribución si la misma persona vuelve desde
otra pieza. Esa tabla no contiene teléfono, nombre ni texto.

Las etapas son independientes:

1. visita: `landing_events.page_view`;
2. clic: evento de CTA real;
3. conversación: sesión de WhatsApp con `content_item_id`;
4. lead: fila real en `leads` con `utm_content`;
5. turno confirmado: `confirmed_booked = true`.

Un clic nunca se eleva a conversación, lead ni turno. Si el botón abre un WhatsApp de terceros que no
llega al webhook —por ejemplo, un número propio de una sede— la app puede comprobar el clic, pero no
la conversación posterior. El panel lo deja en la etapa de clic.

## Panel de rendimiento

`Estudio de contenido → Rendimiento` permite filtrar por período, formato, día de semana, franja ART,
categoría, objetivo, sede y pieza. Cruza la atribución con los snapshots de Meta a 24 h, 72 h y 7 días.
Muestra alcance, visitas al perfil, guardados, compartidos, seguidores por 1.000, clics,
conversaciones, leads y turnos confirmados. El porcentaje de no seguidores se muestra como “No
disponible” porque la conexión actual de Meta no expone esa métrica de forma verificable.

Las visitas ocurren antes de elegir una sede. Al filtrar por sede, el total de visitas permanece como
contexto de la pieza y sólo se filtran las etapas posteriores; no se reparte artificialmente una
visita entre ubicaciones.

## Recomendaciones

El motor compara sólo el mismo formato y objetivo. Cada franja necesita al menos tres piezas con
snapshot comparable a 7 días. Prioriza señales de paciente comprobables por 1.000 alcanzados
(conversación, lead y turno); si aún no existe ninguna, usa guardados + compartidos por 1.000. También
exige una diferencia mínima del 10%.

Sin muestra suficiente muestra: “Todavía no hay datos suficientes para recomendar un cambio”. Una
recomendación puede aprobarse o descartarse. La decisión queda en
`instagram_strategy_recommendations`; nunca modifica `auto_publish_settings` ni publica contenido.

## Migración, despliegue y privacidad

- Migraciones aplicadas: `20260805_instagram_content_attribution.sql` y
  `20260805_instagram_content_attribution_timestamp.sql`; el backfill
  `20260805_instagram_content_attribution_legacy_backfill.sql` copia los códigos históricos a
  `referral_code` antes de reutilizar `utm_content` para la pieza. La migración
  `20260805_instagram_content_conversation_history.sql` agrega el historial inmutable y reemplaza la
  lectura directa de la sesión mutable.
- Variables de Vercel nuevas: ninguna.
- Cron jobs nuevos: ninguno.
- Escritor de WhatsApp: se agregó `upsert_whatsapp_intake_lead_v2`; la RPC anterior queda disponible
  para compatibilidad durante despliegues graduales.
- RLS: recomendaciones sólo lectura para autenticados y escritura por `service_role`; el endpoint de
  revisión exige rol `owner` o `doctor` y la política de acción sensible vigente.
- Datos del panel: agregados. No devuelve teléfono, nombre, texto de mensaje ni otro dato clínico.

## Rollback

Revertir el PR vuelve a usar la RPC anterior y deja las columnas/tablas nuevas sin consumidores. No
borrar columnas ni `instagram_strategy_recommendations`: son aditivas y no alteran el flujo anterior.
La función `instagram_content_attribution` también puede quedar instalada sin efecto. Si hubiera que
desactivar sólo la atribución nueva, revertir el agregado de `Contenido:` en la landing y desplegar;
los clics históricos y el bot siguen funcionando. Durante un rollback, el dashboard legacy no
mostrará en su embudo por sede los leads creados por v2 porque su código está en `referral_code` y no
en `utm_content`; los datos no se pierden y vuelven a aparecer al restaurar este PR.
