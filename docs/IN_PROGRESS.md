# En progreso - Google Business Location ID

## Objetivo

Permitir conectar la ficha de Google Business cuando Google no expone el Account ID y la API de descubrimiento esta con cuota 0.

## Brechas encontradas

- Google OAuth queda conectado, pero `accounts.list` no puede listar negocios si el proyecto tiene cuota 0.
- La interfaz nueva de Google Business no muestra siempre el Account ID.
- La app exigia Account ID aunque la Business Information API puede editar el perfil con `locations/{locationId}`.

## Plan

- [x] Aceptar guardado manual con solo Location ID.
- [x] Mantener Account ID como opcional para cuentas donde Google si lo devuelve.
- [x] Explicar que publicaciones y resenas siguen requiriendo Account ID o acceso API aprobado.
- [x] Dejar Publicaciones en modo manual cuando falta Account ID.
- [x] Verificar, commitear y pushear.

## Resultado

- La seleccion manual de Google Business acepta solo Location ID.
- El Account ID queda opcional para cuentas donde Google lo devuelve automaticamente.
- Publicaciones permite generar y copiar texto manualmente cuando falta Account ID.
- Resenas muestra un mensaje especifico cuando falta Account ID.
- `npm run lint` y `npm run build` finalizaron correctamente.

---

# En progreso - Skills y documentacion PRD/backlog

## Objetivo

Instalar skills utiles para el proyecto y actualizar la documentacion para dejar explicita la necesidad de una pagina web publica de la Dra. Lucia Chahin como activo central de captacion.

## Plan

- [x] Revisar instrucciones de `skill-installer`.
- [x] Instalar skills relevantes para QA, deploy, seguridad y flujo Git.
- [x] Actualizar PRD con la pagina web publica/institucional de Lucia.
- [x] Actualizar backlog de pendientes.
- [x] Verificar cambios, commitear y pushear.

## Skills instaladas

- `playwright`
- `screenshot`
- `vercel-deploy`
- `security-best-practices`
- `security-threat-model`
- `yeet`

Nota: reiniciar Codex para que las nuevas skills queden disponibles en una proxima sesion.

## Resultado

- PRD actualizado a version 2.1 con el sitio web publico de Lucia como activo central de captacion.
- Backlog actualizado con pendientes de web publica, rutas raiz, seguimiento automatico, confirmacion de turno, metricas y schema.
- `npm run lint` finalizo correctamente.
- `npm run build` finalizo correctamente; Next aviso que `middleware` esta deprecado a favor de `proxy`.
