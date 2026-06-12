# Estudio de contenido

## Flujo

1. Elegir categoria, tema, formato y CTA.
2. Buscar informacion reciente.
3. Seleccionar una fuente visible.
4. Generar una propuesta completa con IA.
5. Revisar y editar los textos.
6. Descargar la placa visual y aprobar el borrador.
7. Copiar el contenido a Instagram o publicar en Google Business.

## Fuentes

La busqueda usa Europe PMC y prioriza revisiones y metaanalisis publicados desde 2024 hasta la fecha actual. La fuente elegida queda guardada con el borrador y visible durante la revision.

La IA recibe el titulo, publicacion, fecha y resumen disponible. No debe inventar resultados que no aparezcan en ese contexto ni convertirlos en consejo medico.

## Persistencia

Los borradores se guardan en la clave `content_pipeline` de `app_config`. Esto permite usar el flujo sin ejecutar una migracion adicional. Se conservan hasta 100 piezas.

Estados:

- `draft`: generado y pendiente de revision.
- `approved`: revisado y aprobado por una persona.
- `published`: enviado a Google Business.
- `archived`: retirado de la biblioteca activa.

## Canales

- Instagram: descarga de placa SVG y copia del texto listo para publicar. La publicacion automatica requiere Instagram Graph API.
- Google Business: publicacion desde la app solo para contenido aprobado y cuando Google habilita la API para la cuenta.

## Guardrails

Todo contenido debe evitar diagnosticos, tratamientos, interpretacion de estudios, promesas y mensajes que asuman una condicion medica del lector. Los sintomas de alarma deben derivarse a guardia o atencion medica inmediata.

## Proveedor e idioma

El estudio usa la capa comun de IA de la app. Se puede seleccionar Google Gemini o Anthropic con `AI_PROVIDER`, y todas las propuestas se solicitan explicitamente en espanol.

Con `AI_PROVIDER=auto`, Gemini tiene prioridad cuando `GEMINI_API_KEY` esta configurada. Si un proveedor no tiene saldo o alcanza su cuota, la interfaz muestra un mensaje breve y accionable en lugar del error tecnico de la API.
