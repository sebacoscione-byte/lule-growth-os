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

---

# En progreso - Publicacion automatica en Instagram (Graph API)

## Objetivo

El Estudio de contenido genera caption + placa visual pero requiere copiar/publicar
manualmente en Instagram (nota existente en el editor: "Instagram requiere copiar/publicar
manualmente hasta conectar Instagram Graph API"). Investigacion de repos publicos (insta-p8,
MIT, mismo stack Next.js+Supabase) confirmo el patron correcto: Instagram API with Instagram
Login (graph.instagram.com), sin necesidad de Facebook Page.

## Plan

- [x] Revisar patron OAuth existente de Google Business para replicarlo.
- [x] Migracion: bucket publico de Supabase Storage para las placas generadas.
- [x] `src/lib/instagram-oauth.ts` — state/PKCE/cookies (mismo patron que google-oauth.ts).
- [x] `src/lib/instagram-business.ts` — tokens (app_config) + media container/publish helpers.
- [x] Rutas API: auth, callback, status, disconnect, publish.
- [x] UI: boton "Publicar en Instagram" en el editor + estado de conexion.
- [x] Documentar setup OAuth de Meta en CLAUDE.md (igual que Google Business).
- [x] Lint, build, commit y push.

## Resultado

- Bucket `content-media` (publico, solo service role escribe) vía migracion.
- Conexion Instagram Business vía OAuth con Instagram Login, tokens de larga duracion
  guardados/refrescados en `app_config` (mismo patron que Google).
- Publicar sube la placa generada al bucket, crea el media container, hace polling del
  estado y publica (feed post o story segun formato).
- Boton "Publicar en Instagram" visible cuando el item esta aprobado, tiene placa generada
  y el formato es post/historia (reel/carrusel quedan para una fase futura con soporte de video/multi-imagen).

---

# Especializaciones y enfermedades tratadas de la doctora

## Objetivo

Cargar en la base de la app las especializaciones ("Especialista en: Ecocardiografía,
Electrocardiografía, Cardiología Adulto") y las enfermedades tratadas (Angina de pecho,
Arritmias, Desmayo, Embolismo pulmonar, Endocarditis, Enfermedad de Chagas, Enfermedad
coronaria, Enfermedad valvular, Enfermedad de las arterias carótidas, Espasmo arterial,
Hipertensión arterial, Insuficiencia cardiaca, Soplo cardiaco, Infarto) que el usuario
compartió desde la ficha profesional de Lucía, y mostrarlas también en la web pública.

## Plan

- [x] Agregar `specializations` y `conditions_treated` al tipo `Doctor` y a la card
      "Datos de la doctora" en Configuración (editable con `StringList`, mismo patrón
      que "Prácticas" y "Obras sociales").
- [x] Mostrar ambas listas en la landing pública (todas las rutas `/[slug]`), con
      fallback a los valores cargados si `app_config.doctor` todavía no los tiene.
- [x] Sumar `knowsAbout` al JSON-LD `Physician` de la landing principal para SEO.
- [x] Migración `supabase/migrations/20260703_doctor_specializations.sql` que agrega
      los datos a `app_config` (`update ... value || jsonb` + `insert ... on conflict do nothing`
      como respaldo si la fila no existe).
- [x] Actualizar el seed de `docs/schema.sql` para instalaciones nuevas.
- [x] `npm run lint` y `npm run build` finalizaron correctamente.

## Nota importante

- Esta sesión no tenía `.env.local` en el proyecto, así que **no se pudo correr
  `npm run migrate` contra Supabase**. Falta ejecutarlo (o correr el SQL de
  `supabase/migrations/20260703_doctor_specializations.sql` a mano en el SQL Editor
  de Supabase) para que los datos queden persistidos en producción.
- Mientras tanto, la landing pública ya muestra estos datos gracias al fallback
  hardcodeado en `src/app/landings/[slug]/page.tsx`, así que el sitio no se ve afectado.
