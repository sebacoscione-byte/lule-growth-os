# Backlog — Lule Growth OS

## Fase 1 — MVP (en desarrollo)
- [x] Sitio web público institucional de la Dra. Lucía Chahin en `/dra-lucia-chahin` (MVP básico)
- [x] Publicar slugs SEO en raíz (`/cardiologa-lanus`, `/ecocardiograma-lanus`, etc.)
- [x] Completar contenido institucional de la web pública: quién es Lucía, servicios, sedes, días, instrucciones, avisos y formulario
- [ ] Usar `/dra-lucia-chahin` como link principal para Instagram Bio y Google Business Profile
- [ ] **Profesionalizar `/dra-lucia-chahin`** *(bloqueado: necesita foto y matrícula de Lucía)*
  - [ ] Hero con foto profesional de la Dra. Lucía Chahin
  - [ ] Mostrar número de matrícula (MN o MP) junto al nombre
  - [ ] Bloque "Sobre la doctora" expandido con trayectoria y especialidad
  - [ ] Sección de FAQ con preguntas frecuentes por servicio/sede
  - [ ] Links a Google Maps para cada institución (CIMEL y Swiss Medical)
- [ ] WhatsApp como canal de consulta *(bloqueado: necesita número de WhatsApp de Lucía)*
  - [ ] Botón de WhatsApp con mensaje prearmado según sede elegida
  - [ ] Definir si WhatsApp va en `/dra-lucia-chahin`, en las landings SEO, o en ambas
- [ ] SEO técnico — landings
  - [x] `sitemap.xml` y `robots.txt` (generados automáticamente)
  - [x] Metadata OG/Twitter única por landing
  - [ ] Links internos entre landings SEO (ej. landing Lanús → landing Lomas y viceversa)
  - [ ] Configurar Google Search Console con el sitemap
  - [ ] Datos estructurados JSON-LD (Physician, MedicalBusiness, FAQPage)
- [x] CRM de leads completo (lista, detalle, filtros, búsqueda)
- [x] Carga manual de leads (`/leads/nuevo`)
- [x] Clasificador y generacion con proveedor IA configurable (Gemini/Claude)
- [ ] Generador de respuestas IA en inbox (sugerir texto de seguimiento)
- [x] Seguimiento automático de leads desde formulario público (crear `seguimiento_pendiente` + `followup_due_at` 24hs)
- [x] Flujo dedicado para confirmar "Ya pedí turno" (`confirmed_booked: true`, `status: confirmo_que_pidio_turno`) — botones rápidos en inbox y lead detail
- [x] Flujo dedicado para "No pude pedir" (`status: no_pudo_pedir_turno`, `requires_human: true`) — ídem
- [x] Dashboard con métricas completas de adquisición (leads por canal, servicio, institución, conversión)
- [x] Métricas de CTAs de landings: clicks CIMEL vs Swiss, formularios completados (tabla `landing_events`)
- [x] Export CSV de leads y métricas básicas (`/api/leads/export`)
- [x] Actualizar `docs/schema.sql` para incluir campos UTM/click tracking y tablas IA
- [ ] Google Local checklist
- [x] Landing pages básicas
- [x] Estudio de contenido con IA, fuentes, placas visuales y aprobacion

## Fase 2 — Automatización
- [ ] Integración WhatsApp Business API
- [ ] Integracion Instagram Graph API para publicar contenido aprobado
- [ ] Reportes automáticos
- [ ] Automatización de seguimientos con n8n
- [ ] Métricas por campaña
- [ ] Vincular contenido aprobado con campañas/UTM para medir qué pieza genera leads

## Fase 3 — Escalamiento
- [x] Google Business Profile API (sujeta a disponibilidad y cuotas de Google)
- [ ] Google Search Console
- [ ] Google Analytics
- [ ] Google Ads
- [ ] A/B testing de landings
- [ ] Sistema de recomendaciones de crecimiento
