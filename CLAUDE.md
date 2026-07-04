# Lule Growth OS — Contexto para Claude

## Estado actual
- 2026-06-11: Setup inicial del proyecto. MVP Fase 1 en construcción.

## Qué es esta app
Sistema de adquisición de pacientes para la Dra. Lucía Chahin, cardióloga.
Ayuda a captar leads, clasificarlos con IA, derivarlos al canal correcto (CIMEL Lanús / Swiss Medical Lomas)
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
│   │   └── configuracion/
│   ├── (auth)/login/
│   ├── api/
│   └── landings/        # landing pages públicas SEO
├── lib/
│   ├── supabase/
│   └── ai.ts
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

## Comandos útiles
```bash
# Build
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run build"

# Dev
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run dev"

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

## Doctora y configuración
- **Nombre**: Dra. Lucía Chahin
- **Especialidad**: Cardiología
- **Servicios**: Consulta cardiológica, Ecocardiograma
- **Ubicaciones**:
  - CIMEL Lanús — Tucumán 1314, Lanús — martes
  - Swiss Medical Lomas — viernes
- **Regla crítica**: La app NUNCA da diagnósticos, no reserva turnos, no confirma disponibilidad.

## Guardrails médicos (siempre activos)
- No dar diagnóstico ni tratamiento
- No interpretar estudios
- No confirmar disponibilidad ni reservar turnos
- No hablar en nombre de CIMEL ni Swiss Medical
- Ante síntomas de alarma → derivar a guardia inmediatamente
- Si la consulta es sensible → escalar a humano
