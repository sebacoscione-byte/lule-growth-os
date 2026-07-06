# Lule Growth OS — Contexto para Claude

## Estado actual
- 2026-06-11: Setup inicial del proyecto. MVP Fase 1 en construcción.
- 2026-07-05: Se sumó el Hospital Británico como tercera sede de derivación (miércoles), junto a CIMEL Lanús (martes) y Swiss Medical Lomas (viernes).

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
# Publicacion automatica de contenido (Vercel Cron → /api/cron/publish-content)
CRON_SECRET=                  # String secreto elegido por vos. Sin esto seteado, el cron falla-cerrado (401) y no publica nada
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
automática" para que las piezas aprobadas (posts/historias) se publiquen solas cada N días, sin depender
de que alguien entre a clickear "Publicar". Corre vía un **Vercel Cron** diario (`vercel.json`, 09:00 UTC)
que pega a `/api/cron/publish-content`.

1. **Setear `CRON_SECRET`** en las env vars de Vercel (y en `.env.local` si querés probarlo local) — sin
   esto, el endpoint devuelve 401 y no hace nada (falla-cerrado a propósito).
2. Conectar Instagram y Google Business normalmente (como ya se hacía para publicar a mano).
3. Activar el toggle "Publicación automática" en la tarjeta, elegir cada cuántos días (por defecto 3,
   alineado al ritmo mensual del PRD) y qué canales.
4. Solo se auto-publican piezas `aprobadas` con formato **post** o **historia** — reels y carruseles
   siguen requiriendo publicación manual (no soportado por la API de Meta sin video/multi-imagen).
5. Si algo falla (token vencido, cuenta desconectada, etc.), la pieza queda con un aviso visible en su
   card ("No se pudo auto-publicar en...") y los botones manuales de siempre sirven para reintentar. El
   texto "Último intento: ..." de la tarjeta explica por qué no se publicó nada en la corrida más reciente.
6. **No hay alerta proactiva (WhatsApp/email) si el cron falla** — queda anotado como mejora futura, no
   implementada todavía porque requeriría un template de WhatsApp aprobado por Meta. Revisar la tarjeta
   de vez en cuando, o los logs de función en Vercel, mientras tanto.

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
