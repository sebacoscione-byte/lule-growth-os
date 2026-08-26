# Analítica de campañas y Meta Ads

## Alcance

El dashboard separa dos fuentes para no confundir un clic publicitario con una conversión propia:

1. **Atribución UTM propia**: se obtiene de `landing_events` y `leads`. Mide visitas únicas, visitas
   con una acción de contacto, leads y turnos confirmados por `utm_source`, `utm_medium`,
   `utm_campaign` y `utm_content`.
2. **Entrega publicitaria de Meta**: se consulta en modo lectura desde Marketing API. Mide inversión,
   impresiones, alcance, clics en enlace, CTR y costo por clic por campaña y plataforma.

La primera funciona aunque Meta no esté conectado. La segunda falla de forma no bloqueante: un error
o vencimiento de la credencial nunca impide abrir el dashboard ni borra la atribución propia.

## Campaña inicial

El enlace publicado el 2026-08-26 usa:

- `utm_source=instagram`
- `utm_medium=paid_social`
- `utm_campaign=presentacion_doctora_agosto_2026`
- `utm_content=post_presentacion`

Los valores ya se persistían antes de crear el panel, por lo que el informe es retroactivo. Como el
source es estático, un clic servido por Meta en Facebook sigue figurando como Instagram en la tabla
UTM. El desglose nativo de Meta usa `publisher_platform` y sí distingue Instagram de Facebook.

## Configuración de servidor

El lector requiere estas variables exclusivamente en Vercel Production:

- `META_AD_ACCOUNT_ID`: ID numérico de la cuenta publicitaria; acepta con o sin prefijo `act_`.
- `META_ADS_ACCESS_TOKEN`: credencial de servidor con acceso de lectura `ads_read` a la cuenta.
- `META_GRAPH_API_VERSION`: versión explícita compartida con WhatsApp; producción ya la define.

No guardar valores reales en archivos, documentación, logs, commits, capturas ni conversaciones. El
request usa `Authorization: Bearer`; el token nunca se agrega a la URL. Las respuestas de error de
Meta se descartan y el dashboard sólo recibe un estado cerrado y sanitizado.

## Consulta realizada

Para el período seleccionado en `/dashboard`, el servidor consulta:

- Metadatos mínimos de la cuenta: nombre y moneda.
- Insights a nivel campaña con desglose `publisher_platform`.
- Campos: campaña, gasto, impresiones, alcance, clics internos en enlace y fechas.

El CTR de enlace y el costo por clic se calculan localmente sobre `inline_link_clicks`; no se mezclan
con clics sociales, reacciones u otras interacciones que Meta pueda incluir en su CTR general.

## Privacidad

Esta integración es estrictamente de lectura y sólo consume agregados publicitarios. No envía leads,
datos de pacientes ni eventos del sitio a Meta. No toca el bot, webhooks o datos de WhatsApp.

Pixel y Conversions API quedan fuera de alcance hasta una decisión específica de privacidad para un
sitio médico. Si se consideran en el futuro, deben usar eventos genéricos y nunca incluir información
que revele síntomas, diagnósticos, servicio o sede consultada, datos de contacto o identidad.

## Validación operativa

Después de configurar los activos externos:

1. Abrir `/dashboard?period=7`.
2. Confirmar que la tarjeta de Meta muestra la moneda correcta y actividad de la cuenta esperada.
3. Comparar “Clics en enlace” de Meta con “Visitas” UTM. No tienen que ser idénticos: una persona
   puede tocar el anuncio y no terminar de cargar la landing, repetir el clic o bloquear el tracking.
4. Comparar luego visitas con acción, leads y turnos para evaluar calidad, no sólo volumen.

## Implementación

- Migración: `supabase/migrations/20260826_dashboard_campaign_performance.sql`
- Atribución y tipos: `src/lib/dashboard-growth.ts`
- Cliente de lectura de Meta: `src/lib/meta-ads.ts`
- Presentación: `src/app/(app)/dashboard/page.tsx`
