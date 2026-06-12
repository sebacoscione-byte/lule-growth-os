# En progreso - Estudio de contenido con IA

## Objetivo

Convertir el generador aislado de Instagram en un flujo editorial que permita:

- Investigar temas recientes con fuentes visibles.
- Generar una propuesta para Instagram y Google Business.
- Crear una placa visual de marca sin requerir fotos de la doctora.
- Guardar borradores, aprobarlos y mantener una biblioteca editorial.
- Publicar en Google Business desde la integracion existente cuando la API lo permita.

## Brechas encontradas

- El PRD pide generacion de contenido para Instagram y Google, pero la app actual solo devuelve texto sin persistencia.
- No existe estado de aprobacion, biblioteca, fuente, pieza visual ni trazabilidad editorial.
- Instagram Graph API figura en fase 2 del PRD y todavia no esta integrada.
- Google Business esta integrado, aunque Google puede limitar publicaciones y resenas segun la cuenta/API.
- El repo usa `next.config.ts`, contrario a la convencion definida para este proyecto.

## Plan

- [x] Auditar PRD, codigo y restricciones de canales.
- [x] Agregar investigacion de fuentes recientes.
- [x] Agregar borradores multicanal y placa visual automatica.
- [x] Agregar biblioteca persistida y aprobacion.
- [x] Integrar el borrador aprobado con el flujo de Google Business.
- [x] Actualizar documentacion, verificar, commitear y pushear.

## Resultado

- El modulo `Contenido` consulta revisiones y metaanalisis recientes en Europe PMC, con fecha maxima del dia.
- Claude genera una propuesta coordinada para Instagram y Google Business con guardrails medicos.
- Cada propuesta incluye una placa visual de marca descargable en SVG, por lo que no requiere preparar fotos.
- Los borradores se guardan en `app_config.content_pipeline`, se pueden editar y requieren aprobacion humana.
- Un contenido aprobado se puede enviar a Google Business cuando la API de la cuenta lo permita.
- Instagram queda preparado para copiar texto y descargar la placa; la publicacion automatica requiere Instagram Graph API.
