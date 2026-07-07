# Lule Growth OS — Contexto para Claude

## Estado actual
- 2026-06-11: Setup inicial del proyecto. MVP Fase 1 en construcción.
- 2026-07-05: Se sumó el Hospital Británico como tercera sede de derivación (miércoles), junto a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).
- 2026-07-06: Se eliminó `createServiceClient()` (bug de sesión pisando service_role, ver más abajo) migrando todas las rutas a `getServiceDb()`. Se ampliaron los eventos de landing (visitas + clicks por acción/sede), se agregó ranking de landings, link de seguimiento por pieza de contenido (utm_content) y reportes semanales automáticos en `/dashboard`.
- 2026-07-07: Estudio de contenido — Biblioteca ahora permite crear una pieza en blanco y completarla 100% a mano (sin pasar por generación con IA), incluyendo subir una imagen propia (`/api/content/upload-image`, guarda en `content-media` igual que las placas de Gemini). Cada track de "Publicación automática" (Posts/Historias) tiene su propia fecha de inicio opcional (`starts_at`): mientras no llegue, el cron no publica nada de ese track aunque esté activado, aunque no haya publicado nunca antes.

## Qué es esta app
Sistema de adquisición de pacientes para la Dra. Lucía Chahin, cardióloga.
Ayuda a captar leads, clasificarlos con IA, derivarlos al canal correcto (CIMEL Lanús / Hospital Británico / Swiss Medical Lomas)
y hacer seguimiento hasta que el paciente confirme que pidió turno.
**No da turnos, no reserva horarios, no confirma disponibilidad.**

## Stack
- Next.js 14.2 (App Router) — usar `next.config.mjs`, NO `.ts`
- TypeScript + Tailwind CSS + shadcn/ui (instalado manualmente, sin CLI)
- Supabase (Auth + PostgreSQL) — NO usar generic `createBrowserClient<Database>`
- Google Gemini o Claude mediante `src/lib/ai.ts` para clasificación, respuestas y generación de contenido
- Vercel (deploy automático desde `main`)

## Node.js en Windows
Node está en `C:\Program Files\nodejs\` y no se carga automáticamente en bash.
Siempre ejecutar via:
```
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm ..."
```

## Estructura de archivos clave
```
src/
├── middleware.ts
├── app/
│   ├── (app)/           # rutas protegidas
│   │   ├── layout.tsx
│   │   ├── page.tsx     # dashboard
│   │   ├── leads/
│   │   ├── inbox/
│   │   ├── contenido/instagram/
│   │   ├── google-local/
│   │   ├── landings/
│   │   ├── experimentos/
│   │   ├── costos/          # dashboard de costos del bot de WhatsApp
│   │   └── configuracion/
│   ├── (auth)/login/
│   ├── api/
│   └── landings/        # landing pages públicas SEO
├── lib/
│   ├── supabase/
│   ├── ai.ts
│   ├── whatsapp.ts              # envío (Cloud API) + logging de costo + gate de ventana/template
│   ├── whatsapp-bot.ts          # flujo conversacional (máquina de estados)
│   ├── whatsapp-pricing.ts      # motor de precios (whatsapp_pricing_rules)
│   ├── whatsapp-window.ts       # ventana de 24h / Free Entry Point (Click-to-WhatsApp)
│   ├── whatsapp-cost-tracking.ts
│   ├── whatsapp-templates.ts    # templates aprobados por Meta
│   ├── whatsapp-intents.ts      # intents cerrados (reglas primero, IA de respaldo opcional)
│   ├── whatsapp-consent.ts
│   ├── whatsapp-handoff.ts      # resumen + derivación a humano
│   ├── whatsapp-settings.ts     # app_config.whatsapp_settings (modo ahorro, umbrales, flag oct 2026)
│   └── medical-safety.ts        # detección de síntomas de alarma (determinística)
├── types/
│   └── index.ts
└── components/
    └── ui/
```

## Variables de entorno (.env.local — NO commitear)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_PASSWORD=   # Para migraciones: npm run migrate. Ver: Supabase → Project Settings → Database → Password
AI_PROVIDER=auto
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
# Google Business Profile API (OAuth 2.0)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Opcional si el host publico no coincide con la request:
GOOGLE_OAUTH_BASE_URL=https://tu-dominio.com
# Places API (New) — trae reseñas reales de Google Maps para la landing pública
# (sección "Opiniones de pacientes"). Independiente del OAuth de arriba, no vence.
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACE_ID=
# Instagram API with Instagram Login (publicar posts/historias desde Estudio de contenido)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
# Opcional si el host publico no coincide con la request:
INSTAGRAM_OAUTH_BASE_URL=https://tu-dominio.com
# WhatsApp Business Platform (Cloud API) — bot conversacional
WHATSAPP_PHONE_NUMBER_ID=     # Panel: developers.facebook.com → app → WhatsApp → API Setup
WHATSAPP_ACCESS_TOKEN=        # Token permanente o de sistema (no el temporal de 24h)
WHATSAPP_VERIFY_TOKEN=        # String secreto elegido por vos, para verificar el webhook
# Cron jobs de Vercel (publicacion automatica de contenido + reporte semanal). Mismo secreto para ambos.
CRON_SECRET=                  # String secreto elegido por vos. Sin esto seteado, los crons fallan-cerrado (401) y no corren nada
```

## Optimización de tokens / costos de IA
- `src/lib/ai.ts` ya cachea outputs exactos por hash de prompt en la tabla `ai_outputs` (evita repetir la llamada si el input es idéntico).
- Además usa **prompt caching nativo de Anthropic** (`cache_control: { type: "ephemeral" }`) para los system prompts que no dependen del request (instrucciones fijas tipo `SYSTEM_PROMPT`, reglas de imagen, reglas de captación). Esto se activa con la opción `cacheSystem: true` en `generateText`/`generateWithAnthropic`.
- **Regla al agregar una función nueva en `ai.ts`**: si el `system` que le pasás es 100% estático (no interpola `leadContext`, `topic`, etc. dentro del `system`), agregá `cacheSystem: true`. Si el system tiene contenido dinámico, movelo a `messages` en vez del `system` para poder cachear igual.
- No agregar SDKs/wrappers externos de terceros para esto: `@anthropic-ai/sdk` ya soporta `cache_control` de forma nativa.

## Instagram Business — cómo configurar OAuth (publicar posts/historias)
La app usa "Instagram API with Instagram Login" (graph.instagram.com) — NO requiere una Facebook Page vinculada,
solo una cuenta de Instagram profesional (Business o Creator).
1. Ir a https://developers.facebook.com/apps/ → crear app tipo "Business"
2. Agregar el producto "Instagram" → configurar "Instagram Business Login"
3. Scopes requeridos: `instagram_business_basic`, `instagram_business_content_publish`
4. Authorized redirect URIs (OAuth):
   - `http://localhost:3000/api/instagram-business/callback`
   - `https://TU-DOMINIO/api/instagram-business/callback`
5. Copiar Instagram App ID y App Secret a `.env.local` (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`)
6. Aplicar la migracion `20260702_instagram_content_media.sql` (crea el bucket público `content-media` donde se sube la placa antes de publicarla)
7. En la app ir a Estudio de contenido → "Conectar Instagram" → autorizar con la cuenta de Lucía
8. Publicar posts/historias requiere revisión de la app por parte de Meta antes de salir de modo desarrollo (probar primero con la cuenta agregada como tester en el Meta Developer Console)
9. Reels y carruseles con múltiples imágenes no están soportados todavía (la API de publicación necesita video o varias imágenes por slide) — para esos formatos seguí usando "Copiar Instagram" y publicá manualmente

## Google Business Profile — cómo configurar OAuth
1. Ir a https://console.cloud.google.com/ → crear proyecto
2. Habilitar: "My Business Business Information API", "My Business Account Management API", "Business Profile Performance API"
3. OAuth consent screen → External → agregar scope `https://www.googleapis.com/auth/business.manage`
4. Crear credencial OAuth 2.0 Web → Authorized redirect URIs:
   - `http://localhost:3000/api/google-business/callback`
   - `https://TU-DOMINIO/api/google-business/callback`
5. Copiar Client ID y Client Secret a .env.local
6. En la app ir a Google Business → "Conectar con Google Business Profile" → autorizar
7. **Nota**: mientras el OAuth consent screen esté en modo "Prueba" (no verificado), el refresh
   token vence cada ~7 días y hay que repetir el paso 6. La app avisa esto en pantalla
   (`google-local` muestra "Reconectá el perfil de Google" en vez del mensaje genérico).
   Para que no vuelva a pasar, publicar/verificar el OAuth consent screen para el scope
   `business.manage`.

## Reseñas de Google en la landing pública — cómo configurar Places API
La sección "Opiniones de pacientes" de `/dra-lucia-chahin` trae reseñas reales del perfil de
Google de la doctora vía **Places API (New)**, independiente del OAuth de arriba (usa una
API key simple, no vence). Si no está configurada, se muestra el placeholder honesto de siempre.
1. En el mismo proyecto de Google Cloud (o uno nuevo) → habilitar "Places API (New)"
2. Crear una API key restringida a "Places API (New)" (Credentials → Create credentials → API key → Restrict key)
3. Conseguir el **Place ID** del perfil de Google Business de la Dra. Lucía Chahin (no confundir
   con el `google_location_id` que usa la Business Profile API — son sistemas de ID distintos).
   Se puede obtener con el [Place ID Finder de Google](https://developers.google.com/maps/documentation/places/web-service/place-id)
   buscando "Dra. Lucía Chahin" + la dirección de CIMEL Lanús.
4. Copiar ambos a `.env.local` / Vercel: `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`
5. Muestra hasta 5 reseñas (las que Google elige como "más relevantes") sin filtrar por rating —
   los términos de Google Maps Platform prohíben ocultar reseñas para dar una impresión distinta
   a la real. Se cachean 24h (`next: { revalidate: 86400 }` en `src/lib/google-places.ts`).

## Costos de WhatsApp y templates — cómo completar

El bot de WhatsApp (`src/lib/whatsapp-bot.ts`) usa WhatsApp Business Platform / Cloud API (no la app
común de WhatsApp Business). Meta cobra por mensaje entregado desde el 1/7/2025 y va a empezar a cobrar
también los mensajes `service`/`utility` dentro de la ventana de 24h a partir del **1/10/2026**. El
sistema de costos está preparado para ese cambio, pero **no viene con montos reales cargados**:

1. **Completar los precios reales**: `Configuración → Precios de WhatsApp` lista las reglas de
   `whatsapp_pricing_rules` (categoría, ventana, vigencia). Los montos (`cost_amount`) quedan en blanco
   a propósito — sacálos de WhatsApp Manager → Facturación (varían por cuenta y volumen, Meta no los
   publica en una tabla estática) y cargalos ahí. Sin esto, el dashboard de costos (`/costos`) muestra
   "sin tarifa" en vez de un monto.
2. **Aprobar los 9 templates obligatorios**: `Configuración → Templates de WhatsApp` los lista con texto
   listo para copiar. Enviálos a aprobación real en WhatsApp Manager → Administrador de cuenta →
   Plantillas de mensajes, y una vez que Meta los aprueba, marcá el estado como "Aprobado" en esa misma
   pantalla. **Sin un template aprobado, el bot no puede escribirle a un paciente fuera de la ventana de
   24h** (`sendText`/`sendButtons`/`sendList` lanzan `WindowClosedError` a propósito; usar `sendTemplate`).
3. **Modo ahorro y flag de octubre 2026**: en `Configuración → Bot de WhatsApp` se puede activar
   `cost_saving_mode` (respuestas más compactas, deriva antes a humano) y simular el cobro de octubre
   2026 (`enable_service_message_charging`) antes de que llegue la fecha real, para probar el impacto.
4. **Proveedor de IA del bot**: es independiente del proveedor de IA usado para contenido/Instagram.
   El bot resuelve intents con reglas determinísticas primero (`src/lib/whatsapp-intents.ts`); la IA
   (Gemini/Claude, mismas keys de siempre) solo entra como respaldo opcional si `ai_provider` no es
   "Sin IA". OpenAI / otro LLM / Meta Business Agent aparecen como opciones pero no están implementadas
   todavía (lanzan un error explícito si se seleccionan) — no se agregó esa dependencia sin uso real.

## Publicación automática de contenido — cómo activarla

El Estudio de contenido (`Estudio de contenido → pestaña Biblioteca`) tiene una tarjeta "Publicación
automática" con **dos cronogramas independientes** — Posts de feed e Historias — para que las piezas
aprobadas se publiquen solas cada tantas veces por semana, sin depender de que alguien entre a clickear
"Publicar". Corre vía un **Vercel Cron** diario (`vercel.json`, 09:00 UTC) que pega a
`/api/cron/publish-content` y evalúa ambos cronogramas en la misma corrida (cada uno con su propio
enabled/frecuencia/última publicación).

1. **Setear `CRON_SECRET`** en las env vars de Vercel (y en `.env.local` si querés probarlo local) — sin
   esto, el endpoint devuelve 401 y no hace nada (falla-cerrado a propósito).
2. Conectar Instagram y Google Business normalmente (como ya se hacía para publicar a mano).
3. En la tarjeta, activar el track de **Posts** y/o **Historias** por separado, cada uno con su propio
   "veces por semana" (default: posts 2/semana, historias 3/semana — según investigación de cadencia para
   cuentas de salud: no conviene publicar todos los días, baja la calidad y la credibilidad). Los canales
   (Instagram/Google Business) son compartidos, pero Google Business no tiene concepto de "historia", así
   que ese track en la práctica solo publica a Instagram.
3.1. Cada track tiene además un control **"Empezar: Ahora / fecha programada"** (`starts_at`). Si se deja
   en "Ahora" (`null`), el comportamiento es el de siempre: en cuanto se activa, publica la primera pieza
   aprobada en la próxima corrida del cron. Si se elige una fecha futura, el cron no publica nada de ese
   track hasta que llegue esa fecha (aunque esté activado y ya haya piezas aprobadas esperando) — recién
   ahí arranca a contar el intervalo de "veces por semana" desde la primera publicación real.
4. Cada track solo auto-publica piezas `aprobadas` de su propio formato (**post** o **historia** según
   corresponda) — reels y carruseles siguen requiriendo publicación manual (no soportado por la API de
   Meta sin video/multi-imagen).
5. Además del cron, cada card **aprobada** en Biblioteca tiene un botón **"Publicar ahora"** para publicar
   esa pieza al instante en sus canales asignados, sin esperar al cronograma — útil para piezas puntuales
   o para probar que todo funciona.
6. Si algo falla (token vencido, cuenta desconectada, etc.), la pieza queda con un aviso visible en su
   card ("No se pudo publicar en...") y "Publicar ahora" o los botones manuales del editor sirven para
   reintentar. El texto "Último intento: ..." de cada track explica por qué no se publicó nada en la
   corrida más reciente de ese track.
7. **No hay rampa automática de cadencia** (ej. "3x el primer mes, después 2x") — es una decisión de
   diseño a propósito, para no tener estado oculto difícil de razonar. Si se quiere arrancar más agresivo
   el primer mes, subir el número a mano y bajarlo después.
8. **No hay alerta proactiva (WhatsApp/email) si el cron falla** — queda anotado como mejora futura, no
   implementada todavía porque requeriría un template de WhatsApp aprobado por Meta. Revisar la tarjeta
   de vez en cuando, o los logs de función en Vercel, mientras tanto.

## Reportes semanales y link de seguimiento por pieza — cómo funcionan (2026-07-06)

Un segundo **Vercel Cron** (`vercel.json`, lunes 08:00 UTC, mismo `CRON_SECRET`) pega a
`/api/cron/weekly-report`: calcula leads nuevos, confirmados, tasa de conversión, canales y
visitas/interacciones de landing de los últimos 7 días, y guarda un snapshot en `weekly_reports`
(un registro por semana, se pisa si se re-corre la misma semana). Se ve en `/dashboard` → "Reportes
semanales" — **no se envía a ningún lado**, es el mismo motivo que el punto 8 de arriba (sin template
de WhatsApp aprobado no hay forma de mandarlo proactivamente).

Cada pieza del Estudio de contenido tiene un **link de seguimiento** (`/api/content/track/[itemId]`,
visible en el editor con botón de copiar) que redirige a `/dra-lucia-chahin` con
`utm_content=<id de la pieza>`. La landing pública ya manda ese `utm_content` en sus eventos de
`landing_events`, así que Biblioteca y el editor muestran cuántas visitas/interacciones generó esa
pieza puntual. **Limitación real de la plataforma**: Instagram no permite links clickeables en posts
de feed comunes — este link solo es útil pegado en historias (link sticker) o en la bio/Linktree, no
hay forma de atribuir un post de feed sin pasar por ahí.

## Tests

El proyecto usa **Jest** (`npm test`) para lógica pura sin UI: pricing, ventana de 24h, intents,
consentimiento, guardrail médico, límites de conversación. Los tests viven junto a cada archivo de
`src/lib/` (`*.test.ts`). No hay tests de UI/E2E todavía.

## Comandos útiles
```bash
# Build
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run build"

# Dev
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run dev"

# Tests (Jest)
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm test"

# Migraciones de Supabase (requiere SUPABASE_DB_PASSWORD en .env.local)
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run migrate"
```

## Preferencias de interacción
- **No pedir confirmación antes de actuar.** Ejecutá directamente lo que el usuario pide.
- **Si una tarea deja cambios, cerrar siempre con commit y push.**
- **Solo preguntar cuando hay una decisión real entre múltiples opciones** con consecuencias distintas.
- **Auto-continuar tras compresión de contexto**: Al iniciar una tarea multi-paso (3+ pasos), creá `docs/IN_PROGRESS.md`.
- **Cerrar tareas con documentación al día**.

## Reglas de commit — OBLIGATORIO seguir antes de cada push
1. **Correr el build Y los tests antes de commitear.**
2. **Nunca commitear archivos que importan módulos sin commitear.**
3. **Verificar `git status` antes del push.**
4. **Commitear y pushear `docs/` automáticamente.**
5. **Verificar en código que el bug fue realmente corregido** antes de marcarlo como resuelto.

## Migraciones que tocan `app_config` — NUNCA reemplazar el `value` a ciegas
`app_config.value` (jsonb) es la config que la doctora carga a mano en Configuración
(`whatsapp` propio de cada sede, teléfono, horarios, obras sociales, notas, link de Google Maps, etc.).
El 2026-07-05 una migración para sumar el Hospital Británico hizo
`update app_config set value = '[...]' where key = 'locations'` con un array hardcodeado
de solo 6 campos por sede, y **borró sin dejar rastro** todos los campos que ya estaban
cargados en producción (WhatsApp de Swity en Swiss Medical, teléfonos, etc.) — no eran
parte del array reescrito.
- **Nunca** escribir una migración que haga `set value = '<json literal>'` sobre una fila
  de `app_config` que la UI de Configuración pueda haber modificado en producción.
- Para agregar un elemento a un array jsonb existente: usar `value = value || '[{...}]'::jsonb`
  (concatenar), nunca reemplazar el array entero.
- Para agregar/modificar una clave puntual de un objeto: usar `jsonb_set(value, '{clave}', ...)`.
- Si hay que tocar múltiples campos de un elemento específico de un array, leer el valor actual
  primero (`select value from app_config where key = '...'`) y armar el `UPDATE` a partir de eso,
  no desde un array escrito de memoria en la migración.
- Desde el 2026-07-07 existe `app_config_history` (trigger `before update`) que guarda el valor
  anterior de cualquier fila de `app_config` antes de pisarla — sirve de red de seguridad, pero
  no reemplaza escribir la migración con cuidado.

## Cliente de Supabase con service_role — usar siempre `getServiceDb()`, nunca un cliente con cookies
Para código que necesita permisos de `service_role` (Storage, tablas con RLS restrictivo, webhooks,
cron), usar **`getServiceDb()`** (`src/lib/supabase/service.ts`) — es un cliente de `@supabase/supabase-js`
plano, sin cookies, que siempre autentica como `service_role` real.
- **Nunca** crear un cliente de `@supabase/ssr` (`createServerClient`) pasándole la `service_role` key
  junto con el `cookies` adapter. Ese patrón existió en el proyecto como `createServiceClient()`
  (ya eliminado, 2026-07-06) y tenía un bug crítico: en cuanto había una sesión de usuario activa
  (cookies de auth presentes), el cliente de `@supabase/ssr` hidrataba esa sesión y autenticaba
  **todo** — incluido Storage — como ese usuario en vez de como `service_role`. La policy de Storage
  de `content-media` solo permite escribir a `service_role` real, así que cualquier ruta que subía
  archivos con ese patrón fallaba en silencio.
- Si además necesitás verificar que hay un usuario logueado (rutas de la app, no públicas/webhooks),
  usá **dos clientes separados**: `createClient()` (`src/lib/supabase/server.ts`, cookie-aware) solo
  para `await supabase.auth.getUser()`, y `getServiceDb()` para todas las queries de negocio. Ver
  cualquier ruta de `src/app/api/google-business/` como referencia del patrón.
- Rutas públicas (`api/public/*`, callbacks de OAuth, la landing pública) no necesitan `createClient()`
  en absoluto — no hay sesión de usuario que verificar — así que usan `getServiceDb()` directamente.

## Doctora y configuración
- **Nombre**: Dra. Lucía Chahin
- **Especialidad**: Cardiología
- **Servicios**: Consulta cardiológica, Ecocardiograma
- **Ubicaciones**:
  - CIMEL Lanús — Tucumán 1314, Lanús — martes
  - Hospital Británico — Perdriel 74, CABA — miércoles (turnos: 4309-6400 atención 24hs, Central de Turnos 0810-222-2748 / 11-3015-9749, o app del Hospital Británico)
  - Swiss Medical Lomas — viernes
- **Regla crítica**: La app NUNCA da diagnósticos, no reserva turnos, no confirma disponibilidad.

## Guardrails médicos (siempre activos)
- No dar diagnóstico ni tratamiento
- No interpretar estudios
- No confirmar disponibilidad ni reservar turnos
- No hablar en nombre de CIMEL ni Swiss Medical
- Ante síntomas de alarma → derivar a guardia inmediatamente
- Si la consulta es sensible → escalar a humano
