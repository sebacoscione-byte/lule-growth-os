# Backlog — Lule Growth OS
**Actualizado:** 2026-06-26 | **Basado en:** PRD Estrategia de Captación v2.1

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
- [x] Dashboard: métricas de landings (clicks CIMEL, clicks Swiss, formularios enviados)
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
- [x] Sección "Dónde atiende": CIMEL Lanús — martes / Swiss Medical Lomas — viernes
- [x] CTAs expandibles con instrucciones paso a paso para pedir turno en cada institución
- [x] Formulario "No pude pedir turno" → crea lead `seguimiento_pendiente` con +24h
- [x] Captura de UTM source/medium/campaign/content en el formulario
- [x] Aviso médico visible: no reemplaza consulta, no apta para urgencias, llamar al 107
- [x] Bloque "Sobre la doctora" (contenido básico)

### Profesionalización pendiente ⏳
- [x] Foto profesional de la Dra. Lucía Chahin en el hero — guardar como `public/lucia-chahin.jpg` *(foto recibida, pendiente de subir al servidor)*
- [ ] Número de matrícula (MN o MP) visible junto al nombre — código ya listo (se muestra en hero, "Sobre la doctora", footer y JSON-LD apenas se cargue) *(requiere: número de matrícula de Lucía en Configuración > Datos de la doctora)*
- [x] FAQ: preguntas frecuentes sobre turnos, servicios, cobertura y sedes — 11 preguntas en la landing principal + FAQ corta específica en cada landing SEO
- [x] Links directos a Google Maps para CIMEL Lanús y Swiss Medical Lomas
- [x] Botón de WhatsApp con mensaje prearmado según sede (+5491123842117) — en cada card de sede (sección "Pedir turno") y en cada landing SEO
- [x] Dominio propio — `draluciachahin.ar` registrado en NIC Argentina (1/7/2026)

### Rediseño de conversión (2026-07-04, brief basado en `deep-research-report.md`)
- [x] Hero con CTA primario "Pedir turno" + secundario "Ver sedes y horarios" + chips de confianza
- [x] Nav de anclas fijo (Servicios · Sedes · Obras sociales · FAQ · Pedir turno) en la landing principal
- [x] CTA sticky en mobile ("Pedir turno con la Dra. Chahin") en todas las landings
- [x] Cards de sede con botones de acción reales: "Pedir turno online" (si hay `booking_url` cargado, ej. Swiss Medical), "Llamar" (`tel:`) y "Consultar por WhatsApp" (`wa.me`) — antes eran solo texto/instrucciones sin acción directa
- [x] Servicios como cards con microcopy orientado a síntomas/motivo de consulta
- [x] Sección "Obras sociales y formas de atención" — muestra coberturas cargadas por sede en Configuración, o mensaje honesto invitando a consultar si todavía no hay datos cargados *(pendiente: cargar `obras_sociales` reales por sede en Configuración — hoy están vacías)*
- [x] Sección "Opiniones de pacientes" con placeholder honesto (sin inventar testimonios ni rating falso)
- [x] Campo "Obra social / prepaga" agregado al formulario público de "No pude pedir turno" (antes se guardaba `insurance: null` siempre)
- [x] JSON-LD: `Physician` + `FAQPage` en todas las landings, `BreadcrumbList` en landings SEO, `identifier` (matrícula) cuando esté cargada *(pendiente: `MedicalClinic` por sede)*
- [ ] Eventos de analítica ampliados (click en booking/whatsapp/maps/call por separado) — hoy se sigue registrando `cta_cimel`/`cta_swiss` al primer engagement con cada sede y `form_submitted`; el catálogo completo de eventos sugerido en el brief queda para Etapa 6

### Acciones externas (las hace Lucía)
- [ ] Configurar `/dra-lucia-chahin` como link de la bio en Instagram *(acción de Lucía)*
- [ ] Configurar `/dra-lucia-chahin` como sitio web en Google Business Profile *(acción de Lucía)*

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
- [x] Formulario "No pude pedir turno" en cada landing SEO *(antes solo en /dra-lucia-chahin, ahora reutiliza el mismo componente en las 6 landings SEO)*

### Acciones externas (las hace el equipo)
- [ ] Configurar Google Search Console con el sitemap
- [ ] Verificar indexación de las 7 páginas públicas en Search Console

---

## Etapa 4 — Google Business Profile

Ficha de Google que aparece en Google Maps y búsqueda local. Es el canal con mayor
intención de turno: quien busca "cardióloga en Lanús" tiene alta probabilidad de pedir.

### Módulo en la app ✅
- [x] Checklist de configuración del perfil con ítems priorizados
- [x] Publicaciones: generador con IA + modo manual (copiar y pegar)
- [x] Reseñas: sugerencias de respuesta con IA
- [x] Perfil: editar descripción, horarios, teléfono y sitio web
- [x] Conexión OAuth con Google Business Profile API

### Acciones externas pendientes (las hace Lucía o el equipo)
- [ ] Crear o reclamar el perfil "Dra. Lucía Chahin" en Google Business
- [ ] Completar perfil: foto, servicios, horarios (martes CIMEL, viernes Swiss), descripción
- [ ] Configurar sitio web del perfil → `/dra-lucia-chahin` (no Instagram)
- [ ] Verificar el perfil ante Google
- [ ] Evaluar si crear ficha separada para Swiss Medical Lomas (requiere dirección verificable)
- [ ] Definir estrategia de reseñas: cómo y cuándo pedirlas a pacientes actuales

---

## Etapa 5 — Instagram

Canal de entrada principal junto con Google Maps. Genera confianza y deriva al sitio
público para pedir turno.

### Módulo en la app ✅
- [x] Estudio de contenido: generador de posts, reels y carruseles con IA
- [x] Tab "Bio y Fijados": plantillas de bio, 3 posts fijados, historias destacadas y CTAs correctos

### Acciones externas pendientes (las hace Lucía)
- [ ] Actualizar bio de Instagram con el texto sugerido en la app
- [ ] Cambiar el link de la bio a `/dra-lucia-chahin`
- [ ] Publicar los 3 posts fijados (cómo pedir turno / servicios / dónde atiende)
- [ ] Crear las 6 historias destacadas: Turnos · CIMEL · Swiss · Ecocardiograma · Cardiología · FAQ
- [ ] Establecer ritmo de publicación mensual: 2-3 conversión + 4-6 educativo + 2-3 local

### Automatización (Etapa 7)
- [ ] Publicar contenido aprobado directamente desde la app vía Instagram Graph API

---

## Etapa 6 — Tracking y métricas

### Implementado ✅
- [x] Captura de UTM en todos los leads (source, medium, campaign, content)
- [x] Campos de tracking por interacción: clicked_cimel_cta, clicked_swiss_cta, booking_instruction_viewed
- [x] Registro de eventos de landing: cta_cimel, cta_swiss, form_started, form_submitted
- [x] Dashboard con métricas de conversión global
- [x] Tasa de conversión: confirmaron turno / total leads

### Pendiente
- [ ] Dashboard por landing: visitas, leads generados y conversión por slug
- [ ] Ranking de landings por efectividad
- [ ] Google Analytics: integración para visitas y sesiones por página
- [ ] Métricas por campaña UTM: vincular contenido generado con leads captados

---

## Etapa 7 — Automatización

- [ ] WhatsApp Business API: envío automático de mensajes de seguimiento
- [ ] Configurar `WHATSAPP_VERIFY_TOKEN` en `.env.local` + webhook de prueba separado (vía ngrok) para poder testear localmente cambios en la lógica de recepción de mensajes (`src/lib/whatsapp-bot.ts`) sin tocar el webhook de producción. Sin esto, cualquier cambio en cómo el bot procesa mensajes entrantes solo se puede probar directo en producción. No es urgente mientras no se toque esa lógica.
- [ ] Instagram Graph API: publicación directa desde la app del contenido aprobado
- [ ] Automatización de flujos de seguimiento con n8n
- [ ] Reportes automáticos semanales (leads nuevos, conversión, canales)
- [ ] Vincular campañas UTM con el contenido del estudio para saber qué pieza genera leads

---

## Etapa 8 — Escalamiento

- [ ] Google Search Console: monitorear keywords, indexación y clics
- [ ] Google Analytics: visitas, sesiones, tasa de rebote y conversión por página
- [ ] Google Ads: campañas de búsqueda pagada para Lanús y Lomas de Zamora
- [ ] A/B testing de landings: variantes de hero, CTA y formulario
- [ ] Sistema de recomendaciones de crecimiento basado en métricas acumuladas
