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

---

# En progreso - Web publica y slugs SEO raiz

## Objetivo

Publicar el sitio publico de la Dra. Lucia Chahin en `/dra-lucia-chahin`, exponer las landings SEO en rutas raiz, completar contenido institucional y activar seguimiento automatico desde el formulario publico.

## Plan

- [x] Revisar backlog, PRD y landing existente.
- [x] Publicar slugs raiz reutilizando la landing publica.
- [x] Completar contenido institucional de `/dra-lucia-chahin`.
- [x] Crear leads publicos como `seguimiento_pendiente` con `followup_due_at` +24h.
- [x] Actualizar docs/backlog/schema.
- [x] Correr lint/build, commitear y pushear.

## Resultado

- `/dra-lucia-chahin` y los seis slugs SEO locales quedaron publicados en raiz.
- La pagina principal ahora incluye quien es Lucia, servicios, sedes, dias, instrucciones, avisos y formulario.
- El formulario publico crea leads en `seguimiento_pendiente` con `followup_due_at` a 24 horas.
- `docs/schema.sql` quedo alineado con tracking UTM/clicks y tablas IA.
- `npm run lint` y `npm run build` finalizaron correctamente.
- Verificacion Playwright: `/dra-lucia-chahin` y `/cardiologa-lanus` cargaron con HTTP 200, contenido visible y sin errores de consola.

---

# En progreso - Google OAuth bloqueado por politica

## Objetivo

Resolver el bloqueo `Error 400: invalid_request` al conectar Google Business Profile, alineando el flujo OAuth con validaciones modernas de Google.

## Plan

- [x] Revisar rutas OAuth de Google Business.
- [x] Agregar `state` y PKCE al inicio de autorizacion.
- [x] Validar `state` y reutilizar el mismo redirect URI en callback.
- [x] Derivar el callback desde el host actual y documentar `GOOGLE_OAUTH_BASE_URL` como override opcional.
- [x] Correr lint/build, commitear y pushear.

## Resultado

- El inicio OAuth de Google Business ahora envia `state` y PKCE (`code_challenge_method=S256`).
- El callback valida `state` y usa el mismo redirect URI guardado en cookie httpOnly.
- El redirect URI se deriva del host actual; `GOOGLE_OAUTH_BASE_URL` queda como override opcional para proxies.
- La pantalla Google Local muestra errores de callback en castellano.
- `npm run lint` y `npm run build` finalizaron correctamente.
- Verificacion local: `/api/google-business/auth` devuelve 307 a `accounts.google.com` con `state`, `code_challenge` y cookies OAuth.
