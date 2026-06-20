# Backlog — Lule Growth OS

## Fase 1 — MVP (en desarrollo)
- [x] Sitio web público institucional de la Dra. Lucía Chahin en `/dra-lucia-chahin`
- [x] Publicar slugs SEO en raíz (`/cardiologa-lanus`, `/ecocardiograma-lanus`, etc.) o redireccionar correctamente desde `/landings/[slug]`
- [x] Completar contenido institucional de la web pública: quién es Lucía, servicios, sedes, días, instrucciones, avisos y formulario
- [ ] Usar `/dra-lucia-chahin` como link principal para Instagram Bio y Google Business Profile
- [ ] CRM de leads completo
- [ ] Carga manual de leads
- [x] Clasificador y generacion con proveedor IA configurable (Gemini/Claude)
- [ ] Generador de respuestas
- [x] Seguimiento automático de leads desde formulario público (crear `seguimiento_pendiente` + `followup_due_at` 24hs)
- [ ] Flujo dedicado para confirmar "Ya pedí turno" (`confirmed_booked: true`, `status: confirmo_que_pidio_turno`)
- [ ] Flujo dedicado para "No pude pedir" (`status: no_pudo_pedir_turno`, `requires_human: true`)
- [ ] Dashboard con métricas completas de adquisición
- [ ] Métricas de CTAs de landings: clicks CIMEL vs Swiss, instrucciones vistas y formularios completados
- [ ] Export CSV de leads y métricas básicas
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
