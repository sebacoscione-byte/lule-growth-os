# Backlog — Lule Growth OS
**Actualizado:** 2026-07-06 | **Basado en:** PRD Estrategia de Captación v2.1

---

## Etapa 1 — Infraestructura y CRM ✅

Herramientas internas de la app para gestionar leads, contenido y seguimiento.

- [x] CRM: lista de leads con filtros por estado, canal y servicio
- [x] CRM: carga manual de leads (`/leads/nuevo`)
- [x] CRM: detalle de lead con historial de mensajes
- [x] CRM: acciones rápidas "Ya pidió turno" y "No pudo pedir" desde detalle e inbox
- [x] CRM: seguimiento automático +24h al crear lead desde formulario público
- [x] CRM: export CSV de leads con todos los campos
- [x] Inbox: conversación por lead con respuesta automática IA
- [x] Inbox: botón "Sugerir mensaje de seguimiento" con IA (`/api/ai/suggest`)
- [x] Clasificador IA configurable (Gemini / Claude) con fallback automático
- [x] Dashboard: KPIs de conversión (total leads, confirmados, seguimiento pendiente, urgencias)
- [x] Dashboard: leads por canal de origen (Google Maps, Instagram, Google Search, WhatsApp, manual)
- [x] Dashboard: leads por servicio solicitado y por institución preferida
- [x] Dashboard: métricas de landings (clicks CIMEL, clicks Británico, clicks Swiss, formularios enviados)
- [x] Sumado Hospital Británico como tercera sede de derivación (miércoles), junto a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes) — tipos, prompts de IA, bot de WhatsApp, landings y dashboard
- [x] Estudio de contenido: generador de posts/reels/carruseles con IA, fuentes y placas visuales
- [x] Rate limiting por IP en APIs públicas (anti-spam básico)
- [x] CI: lint + build automático en cada push a main (GitHub Actions)

---

## Etapa 2 — Web pública: /dra-lucia-chahin

La página pública principal. Activo central de captación — punto de llegada desde
Google Maps, Instagram, WhatsApp y búsqueda orgánica.

### Implementado ✅
- [x] Página pública en `/dra-lucia-chahin` accesible sin login
- [x] Hero con nombre, especialidad e intro de la doctora
- [x] Sección servicios: consulta cardiológica, ecocardiograma, control, evaluación cardiovascular
- [x] Sección "Dónde atiende": CIMEL Lanús — martes / Hospital Británico — miércoles / Swiss Medical Lomas — viernes
- [x] CTAs expandibles con instrucciones paso a paso para pedir turno en cada institución
- [x] Captura de UTM source/medium/campaign/content (se usa en los eventos `cta_cimel`/`cta_britanico`/`cta_swiss`)
- [x] Aviso médico visible: no reemplaza consulta, no apta para urgencias, llamar al 107
- [x] Bloque "Sobre la doctora" (contenido básico)

### Profesionalización pendiente ⏳
- [x] Foto profesional de la Dra. Lucía Chahin en el hero — guardar como `public/lucia-chahin.jpg` *(foto recibida, pendiente de subir al servidor)*
- [x] Número de matrícula (MN o MP) visible junto al nombre — cargada por Lucía en Configuración > Datos de la doctora el 2026-07-05 (MN 176700), visible en hero, "Sobre la doctora", footer y JSON-LD
- [x] FAQ: preguntas frecuentes sobre turnos, servicios, cobertura y sedes — 11 preguntas en la landing principal + FAQ corta específica en cada landing SEO
- [x] Links directos a Google Maps para CIMEL Lanús y Swiss Medical Lomas *(pendiente: link de Google Maps del Hospital Británico en Configuración)*
- [x] Botón de WhatsApp con mensaje prearmado según sede (+5491178285006) — en cada card de sede (sección "Pedir turno") y en cada landing SEO
- [x] Dominio propio — `draluciachahin.ar` registrado en NIC Argentina (1/7/2026)

### Rediseño de conversión (2026-07-04, brief basado en `deep-research-report.md`)
- [x] Hero con CTA primario "Pedir turno" + secundario "Ver sedes y horarios" + chips de confianza
- [x] Nav de anclas fijo (Servicios · Sedes · Obras sociales · FAQ · Pedir turno) en la landing principal
- [x] CTA sticky en mobile ("Pedir turno con la Dra. Chahin") en todas las landings
- [x] Cards de sede con botones de acción reales: "Pedir turno online" (si hay `booking_url` cargado, ej. Swiss Medical), "Llamar" (`tel:`) y "Consultar por WhatsApp" (`wa.me`) — antes eran solo texto/instrucciones sin acción directa
- [x] Servicios como cards con microcopy orientado a síntomas/motivo de consulta
- [x] Sección "Obras sociales y formas de atención" — muestra coberturas cargadas por sede en Configuración, o mensaje honesto invitando a consultar si todavía no hay datos cargados *(pendiente: cargar `obras_sociales` reales por sede en Configuración — hoy están vacías)*
- [x] Sección "Opiniones de pacientes" — reseñas reales de Google vía Places API (New) desde el 2026-07-04 (`GOOGLE_PLACES_API_KEY` + `GOOGLE_PLACE_ID`, ver CLAUDE.md). Cae al placeholder honesto si la API no está disponible.
- [x] JSON-LD: `Physician` + `FAQPage` en todas las landings, `BreadcrumbList` en landings SEO, `identifier` (matrícula) cuando esté cargada *(pendiente: `MedicalClinic` por sede)*
- [x] Eventos de analítica ampliados (2026-07-06) — `landing_events` ahora también registra `page_view` (una vez por carga de landing) y clicks separados por acción (`click_booking`/`click_call`/`click_whatsapp`/`click_maps`) con `location_key` por sede, además de los `cta_*` históricos que se mantienen para no romper las métricas globales existentes. El link "Cómo llegar" no trackeaba nada antes; ahora sí.

### Revertido (2026-07-04)
- [x] ~~Formulario "No pude pedir turno" en las landings~~ — se sacó de la web pública. Creaba un lead `seguimiento_pendiente` prometiendo "te ayudamos", pero **hoy nadie revisa el CRM/Inbox** para mandar ese seguimiento manual (`/api/followup` requiere que un usuario logueado lo dispare a mano). Mostrar el formulario sin nadie contestando es peor que no tenerlo. Quedan solo los canales que responden solos: llamar y el bot de WhatsApp. El backend (`/api/public/lead`, con el campo `insurance` ya soportado) queda intacto sin uso — reactivar cuando haya alguien asignado a hacer el seguimiento manual, o cuando se automatice la respuesta por WhatsApp (Etapa 7).

### Acciones externas (las hace Lucía)
- [x] Configurar `/dra-lucia-chahin` como link de la bio en Instagram — hecho vía dominio propio `draluciachahin.ar`, ver Etapa 5
- [ ] Configurar `/dra-lucia-chahin` como sitio web en Google Business Profile *(acción de Lucía)*

### Decisión pendiente: Google Cloud — fin de la prueba gratuita (~90 días desde 2026-07-04)
El proyecto de Google Cloud usado para Places API (reseñas) quedó en modo prueba gratuita
($300 de crédito, 90 días) a propósito: mientras esté en prueba, Google no puede cobrar nada
aunque se supere el crédito, solo pausa el servicio. Como respaldo para cuando eventualmente
se decida activar la cuenta completa, ya se armó un corte automático de facturación
(tema de Pub/Sub `presupuesto-alertas` → Cloud Run function `cortar-facturacion` → presupuesto
de $1/mes que la dispara). Sin uso real, no hay apuro en activar.
- [ ] Revisar antes de que venza la prueba (~inicios de octubre 2026): decidir si se activa la
      cuenta completa (necesario si se quiere seguir mostrando reseñas de Google después de esa
      fecha) o se deja pausar solo. Si se activa, confirmar que el corte automático de
      facturación sigue funcionando.

---

## Etapa 3 — Landings SEO locales

6 páginas con keyword local, una por combinación de servicio + sede. Generan tráfico
orgánico de búsqueda y convierten con instrucciones claras para pedir turno.

### Implementado ✅
- [x] `/cardiologa-lanus` — Cardióloga en Lanús
- [x] `/cardiologa-lomas` — Cardióloga en Lomas de Zamora
- [x] `/ecocardiograma-lanus` — Ecocardiograma en Lanús
- [x] `/ecocardiograma-lomas` — Ecocardiograma en Lomas de Zamora
- [x] `/consulta-cardiologica-lanus` — Consulta cardiológica en Lanús
- [x] `/consulta-cardiologica-lomas` — Consulta cardiológica en Lomas de Zamora
- [x] Contenido único por landing: título, intro, instrucciones y sede específica
- [x] Metadata SEO única por landing: title, description, canonical, OG, Twitter card
- [x] `sitemap.xml` generado automáticamente (todas las landings)
- [x] `robots.txt` con rutas públicas permitidas y rutas internas bloqueadas
- [x] Link a `/dra-lucia-chahin` desde cada landing SEO

### Pendiente
- [x] FAQ específica por landing (preguntas frecuentes distintas por servicio/sede)
- [x] Links internos entre landings (ej. Lanús → Lomas y viceversa, para SEO)
- [x] Datos estructurados JSON-LD (Physician, FAQPage, BreadcrumbList) *(MedicalClinic por sede pendiente)*
- [ ] ~~Formulario "No pude pedir turno" en cada landing SEO~~ — revertido, ver nota en Etapa 2

### Acciones externas (las hace el equipo)
- [ ] Configurar Google Search Console con el sitemap
- [ ] Verificar indexación de las 7 páginas públicas en Search Console

---

## Etapa 4 — Google Business Profile

Ficha de Google que aparece en Google Maps y búsqueda local. Es el canal con mayor
intención de turno: quien busca "cardióloga en Lanús" tiene alta probabilidad de pedir.

### Módulo en la app ✅
- [x] Checklist de configuración del perfil con ítems priorizados
- [x] Checklist: 5 de 14 items se auto-detectan leyendo el perfil real de Google en cada carga
      (nombre, descripción, horario del martes, link a la landing, teléfono) — quedan no-editables
      con badge "Detectado automáticamente" mientras Google esté conectado; si se desconecta, caen
      de vuelta al valor manual guardado (2026-07-07). Los 9 restantes (categorías, fotos, Q&A,
      pin del mapa, servicios, y 2 que en realidad son de Instagram) no tienen forma de verificarse
      por API — ver `src/lib/google-business.ts` → `computeChecklistAutoStatus`.
- [x] Publicaciones: generador con IA + modo manual (copiar y pegar)
- [x] Reseñas: sugerencias de respuesta con IA
- [x] Perfil: editar descripción, horarios, teléfono y sitio web
- [x] Conexión OAuth con Google Business Profile API

### Acciones externas pendientes (las hace Lucía o el equipo)
- [ ] Crear o reclamar el perfil "Dra. Lucía Chahin" en Google Business
- [ ] Completar perfil: foto, servicios, horarios (martes CIMEL, miércoles Británico, viernes Swiss), descripción
- [ ] Configurar sitio web del perfil → `/dra-lucia-chahin` (no Instagram)
- [ ] Verificar el perfil ante Google
- [ ] Evaluar si crear ficha separada para Swiss Medical Lomas (dirección ya confirmada: Oliden 141, Lomas de Zamora)
- [ ] Definir estrategia de reseñas: cómo y cuándo pedirlas a pacientes actuales

### Pendiente: cuota 0 en la GBP API (bloquea Perfil/Publicaciones/Reseñas dentro de la app)
Las pestañas **Perfil**, **Publicaciones** y **Reseñas** de Google Local muestran "cuota API = 0" /
"Falta Account ID". Confirmado 2026-07-05: el proyecto de Google Cloud (`app-lule`) tiene cuota 0 por
defecto en `mybusinessbusinessinformation.googleapis.com` y `mybusinessaccountmanagement.googleapis.com`
(`RESOURCE_EXHAUSTED`, `quota_limit_value: "0"`) — es una restricción anti-abuso de Google en todos los
proyectos nuevos, **no tiene costo**, solo requiere pedir el aumento de cuota.
- [ ] Solicitar aumento de cuota en `https://cloud.google.com/docs/quotas/help/request_increase`
      (proyecto `app-lule`) para `My Business Business Information API` y
      `My Business Account Management API`. Mientras tanto, editar perfil/posts/reseñas desde el
      panel oficial de Google Business directamente (los links "Ir a Google Business" en cada tab).

---

## Etapa 5 — Instagram

Canal de entrada principal junto con Google Maps. Genera confianza y deriva al sitio
público para pedir turno.

### Módulo en la app ✅
- [x] Estudio de contenido: generador de posts, reels y carruseles con IA
- [x] Tab "Bio y Fijados": plantillas de bio, 3 posts fijados, historias destacadas y CTAs correctos

### Acciones externas pendientes (las hace Lucía)
- [x] Actualizar bio de Instagram con el texto sugerido en la app — confirmado en producción (@draluciachahin) 2026-07-07
- [x] Cambiar el link de la bio a `/dra-lucia-chahin` — usa el dominio propio `draluciachahin.ar`
- [ ] Publicar los 3 posts fijados (cómo pedir turno / servicios / dónde atiende)
- [ ] Crear las 7 historias destacadas: Turnos · CIMEL · Hospital Británico · Swiss · Ecocardiograma · Cardiología · FAQ
- [ ] Establecer ritmo de publicación mensual: 2-3 conversión + 4-6 educativo + 2-3 local

### Automatización (Etapa 7)
- [x] Publicar contenido aprobado directamente desde la app vía Instagram Graph API — primer post real
      confirmado en producción 2026-07-07 (@draluciachahin).

---

## Etapa 6 — Tracking y métricas

### Implementado ✅
- [x] Captura de UTM en todos los leads (source, medium, campaign, content)
- [x] Campos de tracking por interacción: clicked_cimel_cta, clicked_swiss_cta, booking_instruction_viewed
- [x] Registro de eventos de landing: cta_cimel, cta_swiss, form_started, form_submitted
- [x] Dashboard con métricas de conversión global
- [x] Tasa de conversión: confirmaron turno / total leads

### Implementado ✅ (2026-07-06)
- [x] Dashboard por landing: visitas y interacciones por slug (`/dashboard` → "Ranking de landings"),
      ordenado por tasa de interacción. *Nota honesta: no es "leads generados" en sentido estricto —
      el formulario público que hubiera atribuido un lead a un slug está revertido (ver Etapa 2), así
      que hoy no hay un canal real que genere leads atribuibles a una landing puntual. Se usa
      visitas + clicks en pedir turno/llamar/WhatsApp/cómo llegar como proxy de interés real.*
- [x] Ranking de landings por efectividad — mismo tablero, ordenado por tasa de interacción.

### Pendiente
- [x] Google Analytics: integración para visitas y sesiones por página (2026-07-07) — script GA4
      (`src/components/google-analytics.tsx`) inyectado en la landing principal y las 6 landings SEO,
      no en el CRM interno. *Falta la acción externa: crear la cuenta/propiedad GA4 y cargar
      `NEXT_PUBLIC_GA_MEASUREMENT_ID` (ver CLAUDE.md → "Google Analytics — cómo activarlo"). Sin eso
      no se inyecta ningún script, no bloquea nada.*
- [x] Métricas por campaña UTM: vincular contenido generado con leads captados — cada pieza del
      Estudio de contenido tiene un "Link de seguimiento" (`/api/content/track/[itemId]`) que redirige
      a `/dra-lucia-chahin` con `utm_content=<id>`; Biblioteca y el editor muestran visitas/interacciones
      atribuidas a esa pieza. *Limitación real: Instagram no permite links clickeables en posts de feed,
      así que solo sirve para historias (link sticker) o para pegarlo en la bio/Linktree — no hay forma
      de atribuir un post de feed común sin ese link.*

---

## Etapa 7 — Automatización

- [x] Arquitectura de costos de WhatsApp Business Platform (2026-07-04): tracking de mensajes/costo
      por categoría (`whatsapp_pricing_rules`, `whatsapp_cost_events`), ventana de 24h + Free Entry
      Point (Click-to-WhatsApp), gate de template fuera de ventana, `templates` (9 obligatorios),
      `consent_records`, `handoff_events`, intents cerrados con reglas primero e IA de respaldo
      opcional, modo ahorro y flag de simulación del cobro de octubre 2026, dashboard `/costos`,
      suite de tests con Jest (nueva en el proyecto). Detalle de setup pendiente (montos reales de
      precios + aprobación de templates en Meta) en `CLAUDE.md` → "Costos de WhatsApp y templates".
- [x] WhatsApp Business API: envío automático de mensajes de seguimiento (2026-07-07) — leads sin
      confirmar turno reciben el template `recontacto_incompleto` vía `sendTemplate`, corriendo dentro
      del cron de `publish-content` (sin cron propio, para no superar el límite de 2 crons del plan
      Hobby de Vercel). Ver `src/lib/whatsapp-followup.ts` y `CLAUDE.md` → "Seguimiento automático de
      leads por WhatsApp". *Requiere aprobar el template `recontacto_incompleto` en Meta antes de que
      mande algo real — mientras tanto el cron lo reporta como pendiente sin hacer nada.* Los demás
      templates (`recordatorio_turno`, `seguimiento_post_consulta`, etc.) siguen sin automatizar porque
      necesitan una fecha de turno real que la app no gestiona.
- [ ] Configurar `WHATSAPP_VERIFY_TOKEN` en `.env.local` + webhook de prueba separado (vía ngrok) para poder testear localmente cambios en la lógica de recepción de mensajes (`src/lib/whatsapp-bot.ts`) sin tocar el webhook de producción. Sin esto, cualquier cambio en cómo el bot procesa mensajes entrantes solo se puede probar directo en producción. No es urgente mientras no se toque esa lógica.
- [x] Instagram Graph API: publicación directa desde la app del contenido aprobado (2026-07-06/07) —
      manual ("Publicar ahora" y botones por canal en el editor) y automática (Vercel Cron diario,
      dos cronogramas independientes: posts de feed y historias, cada uno con su propia frecuencia
      "veces por semana"). Ver `src/lib/content-publish.ts`, `src/app/api/cron/publish-content/`,
      `docs/CONTENT_STUDIO.md` → "Publicacion automatica".
- [ ] Automatización de flujos de seguimiento con n8n
- [x] Reportes automáticos semanales (2026-07-06, movido a domingo 2026-07-07) — cron semanal
      (`/api/cron/weekly-report`, domingo 08:00 UTC = 05:00 ART) calcula leads nuevos, confirmados,
      tasa de conversión, canales y visitas/interacciones
      de landing de los últimos 7 días y los guarda en `weekly_reports`; se ven en `/dashboard` →
      "Reportes semanales". *No se envía por WhatsApp/email de forma proactiva — ese canal no existe
      todavía (requeriría un template de WhatsApp aprobado por Meta), así que queda para consultar en
      la app en vez de mandarse solo.*
- [x] Vincular campañas UTM con el contenido del estudio para saber qué pieza genera leads — ver nota
      en Etapa 6 (link de seguimiento por pieza)
- [x] Carga manual de piezas en Estudio de contenido (2026-07-07) — botón "Crear pieza en blanco" en
      Biblioteca abre el editor con todos los campos vacíos para completar 100% a mano, sin generar con
      IA; se puede subir una imagen propia (`/api/content/upload-image`, mismo bucket `content-media` que
      las placas de Gemini) y aprobar directamente para que entre a la cola de publicación.
- [x] Fecha de inicio programable por track de "Publicación automática" (2026-07-07) — Posts de feed e
      Historias tienen cada uno un control "Empezar: Ahora / fecha programada" (`starts_at` en
      `AutoPublishTrackSettings`); si se elige una fecha futura, el cron no publica nada de ese track
      hasta llegar a esa fecha, aunque ya haya piezas aprobadas en cola.

---

## Etapa 8 — Escalamiento

- [ ] Google Search Console: monitorear keywords, indexación y clics
- [ ] Google Analytics: visitas, sesiones, tasa de rebote y conversión por página
- [ ] Google Ads: campañas de búsqueda pagada para Lanús y Lomas de Zamora
- [x] A/B testing de landings (2026-07-07) — primer test real en producción: la landing principal
      (`/dra-lucia-chahin`) asigna automáticamente, por cookie (`lule_hero_variant`, 90 días), cuál de
      los dos botones del hero es primario — "Pedir turno" (variante A, control) o "Ver sedes y
      horarios" (variante B). Asignación 50/50 en `middleware.ts`, sin cuenta de usuario ni backend de
      experimentos: el visitante siempre ve la misma variante mientras dure la cookie. Resultados en
      `/dashboard` → "Test A/B: hero de la landing principal" (visitas, clicks por botón e
      interacciones downstream por variante, últimos 90 días). *Alcance a propósito: solo la landing
      principal (las 6 landings SEO tienen un hero más simple, de un solo botón, sin tocar) y un solo
      test a la vez — no se construyó una plataforma de experimentos genérica todavía. No hay ganador
      automático: hay que mirar la tabla y decidir a mano cuándo cortar el test.* Ver
      `src/middleware.ts`, `src/app/landings/[slug]/page.tsx`, `src/app/landings/[slug]/hero-cta-link.tsx`,
      `src/lib/landing-track.ts`, migración `20260707_landing_events_variant.sql`.
- [x] Sistema de recomendaciones de crecimiento (2026-07-07) — motor de reglas simples (sin ML) sobre
      datos que la app ya junta en 4 canales, mostrado en `/dashboard` → "Recomendaciones de
      crecimiento". Cada regla es pura y está testeada por separado (`src/lib/growth-recommendations.ts`,
      38 tests): **web** (landing con muchas visitas y baja interacción, landing sin ninguna visita,
      sede sin obras sociales cargadas, señal para cortar el test A/B del hero), **WhatsApp** (costo
      proyectado sobre el presupuesto, templates sin aprobar, conversaciones abandonadas sin derivar),
      **Instagram** (no conectado, publicación automática apagada, última corrida con error, track
      activado que no publica hace más de 21 días) y **Google Maps** (reseñas no configuradas, pocas
      reseñas, rating bajo, Google Business no conectado). *Sin acción automática — cada recomendación
      es informativa, la decisión la sigue tomando una persona.* No incluye Google Search Console/Ads
      ni tasa de rebote de GA (esos dos ítems de arriba siguen pendientes, son acciones externas de
      configuración, no datos que la app ya tenga).

---

## Pendientes — sin sesión asignada

### [TECH] ✅ Resuelto (2026-07-06): `createServiceClient()` vs `getServiceDb()`
Se auditaron y migraron las ~14 rutas restantes que usaban `createServiceClient()` (todas las de
`google-business/*` e `instagram-business/*` que faltaban, `public/click`, `public/lead`, y la landing
pública `src/app/landings/[slug]/page.tsx`) a `getServiceDb()`. Como ya no queda ningún uso real, se
**eliminó por completo** la función `createServiceClient()` de `src/lib/supabase/server.ts` para que no
se pueda volver a usar por error. Regla documentada en `CLAUDE.md` → "Cliente de Supabase con
service_role — usar siempre `getServiceDb()`, nunca un cliente con cookies".

### [TECH] ✅ Resuelto (2026-07-07): reintentar publicación duplicaba posts en el canal que ya había salido bien
`resolveChannelsToPublish` intersectaba canales pedidos vs. habilitados pero no miraba
`auto_publish_result`, así que reintentar tras una publicación parcial (ej. Instagram OK, Google
Business falló) volvía a publicar también en el canal ya exitoso. Afectaba al cron y a "Publicar
ahora" (este último ni siquiera llamaba a la función). Se corrigió para excluir canales con resultado
`"published"` — ver `src/lib/content-pipeline.ts`.

### [DECISIÓN] Google Business: descartado del front de Estudio de contenido (2026-07-07)
La API de Google (`accounts.list`) nunca devolvió `account_id` para la sede conectada, así que
publicar posts ahí siempre iba a requerir el paso manual de copiar/pegar (la cuenta probablemente es
Manager, no Owner directo del perfil). El usuario decidió no mantener trabajo manual recurrente por
un canal de bajo impacto: se sacó del front (checkbox de canal, textarea, botones de publicación,
banner manual), pero el backend (`google-business.ts`, `content-publish.ts`,
`resolveChannelsToPublish`) sigue siendo genérico multi-canal para reactivarlo más adelante sin
reconstruir nada. El pendiente de aumento de cuota en Etapa 4 sigue vigente para Perfil/Reseñas (no
relacionado a este tema).

### [FEATURE] ✅ Resuelto (2026-07-07): Alerta proactiva si falla el cron de auto-publicación
Se evaluó automatizar esto con n8n, pero no había ninguna necesidad real que justificara sumar una
herramienta nueva (self-hosteada o paga) — los flujos repetitivos del proyecto ya corren directo en
crons de Vercel. Se resolvió más simple: `/api/cron/publish-content` y `/api/cron/weekly-report` ahora
mandan un email de alerta (vía Resend, `src/lib/alert-email.ts`) ante una excepción no controlada o un
error real (no ante estados esperados como `skipped_*`). Por WhatsApp seguiría requiriendo un template
aprobado por Meta, así que se optó por email. Fail-open a propósito: sin `RESEND_API_KEY`/`ALERT_EMAIL_TO`
configuradas, no manda nada y no bloquea el cron — ver `CLAUDE.md` → "Alertas de cron por email".

### [SECURITY] ✅ Resuelto (2026-07-07): OAuth de Google Business/Instagram sin auth + webhook de WhatsApp sin firma
Auditoría de seguridad completa encontró y corrigió 3 vulnerabilidades reales: `/api/google-business/auth`,
`/api/instagram-business/auth` y sus `/callback` no requerían sesión (cualquiera con la URL podía
secuestrar la conexión con su propia cuenta de Google/Instagram); los `/status` de ambas integraciones
filtraban datos sin auth; y el webhook de WhatsApp no verificaba `X-Hub-Signature-256`, permitiendo
mensajes "entrantes" forjados. Los tres quedaron corregidos y mergeados — `WHATSAPP_APP_SECRET` ya está
cargado en Vercel y confirmado activo con una prueba real. Detalle completo en memory
`project_security_audit_2026-07-07`.

### [SECURITY] ✅ Resuelto (2026-07-07): Alta de usuarios (signup) cerrada en Supabase Auth
Las políticas RLS de `leads`, `messages`, `app_config`, etc. dan acceso total de lectura/escritura a
"cualquier usuario autenticado" (`to authenticated using (true)`) — es un patrón razonable para un
equipo chico, pero solo es seguro si el registro de cuentas nuevas por email está deshabilitado. Se
verificó en el dashboard de Supabase (Authentication → Sign In / Providers) que "Allow new users to
sign up" estaba **prendido** (cualquiera podía registrarse y quedar con acceso total) — se apagó y
guardó. Solo quedan los 3 usuarios ya existentes (dra. Lucía, lchahin2015, Seba); para sumar gente
nueva al equipo hay que crearla a mano desde Authentication → Users → Add user.

### [TECH] `npm audit`: vuln moderada transitiva en `postcss` (vía `next`)
XSS en el stringify de CSS de `postcss` (`GHSA-qx2v-qp2m-jg93`), dependencia interna de `next`. El fix
automático (`npm audit fix --force`) bajaría Next a una versión canary vieja — no conviene. Bajo riesgo
real (no hay contenido de usuario que fluya a valores CSS en esta app). Esperar a que Next libere un
patch que actualice su propia dependencia de `postcss`.

### [TECH] ✅ Resuelto (2026-07-08): ciclo de vida de piezas en Estudio de contenido (archivar/restaurar, edición de publicadas, UX de placa/alt text)
Auditoría de "borradores" encontró y corrigió 3 problemas reales (PR #12, #13, #14):
1. "Restaurar pieza" desde archivo siempre volvía a `"draft"`, sin importar si estaba `"approved"` o
   `"published"` antes de archivarse — una pieza ya publicada en Instagram podía quedar como si nunca
   se hubiera posteado. Se agregó `archived_from_status` en `ContentItem` para restaurar al estado real.
2. Editar el contenido de una pieza `"published"` y guardar la revierte a `"draft"` en silencio
   (comportamiento intencional desde antes, para no dejar contenido sin revisar marcado como
   publicado) — se agregó la misma confirmación que ya tenía "Deshacer publicación".
3. Dos botones "Regenerar" con alcance muy distinto (alt text vs. concepto de la imagen) generaban
   confusión real de uso (clicks repetidos al equivocado). Tras dos iteraciones de UI que no
   alcanzaron, se resolvió eliminando el campo de alt text de la vista por completo — se sigue
   generando solo, en segundo plano, sin intervención manual. Detalle en memory
   `project_content_draft_lifecycle_fixes` y `feedback_ui_completeness_lule` (caso 7).

### [TECH] Falta página de Política de Privacidad + instrucciones de borrado de datos
Ninguna existe hoy (`grep -i "privacidad|privacy|terms"` sobre `src/app` no encontró nada). Son
requisito de Meta para cualquier App Review de "Instagram Login" (permisos `instagram_business_basic`,
`instagram_business_content_publish`). No es urgente mientras la única cuenta de Instagram conectada
(la de Lucía) siga agregada como tester en el Meta App — el modo desarrollo no expira para
testers/admins. Si en algún momento se decide sacar la app del modo desarrollo, hace falta: página
pública `/privacidad` con qué datos de leads se recolectan y cómo se usan, y una URL o texto de
instrucciones de borrado de datos. Ver memoria `project_meta_business_checklist`.
