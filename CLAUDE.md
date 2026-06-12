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
- Claude API (claude-sonnet-4-6) para clasificación y generación de contenido
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
│   └── claude.ts
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
ANTHROPIC_API_KEY=
# Google Business Profile API (OAuth 2.0)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-business/callback
```

## Google Business Profile — cómo configurar OAuth
1. Ir a https://console.cloud.google.com/ → crear proyecto
2. Habilitar: "My Business Business Information API", "My Business Account Management API", "Business Profile Performance API"
3. OAuth consent screen → External → agregar scope `https://www.googleapis.com/auth/business.manage`
4. Crear credencial OAuth 2.0 Web → Authorized redirect URI: `http://localhost:3000/api/google-business/callback` (+ URI de producción)
5. Copiar Client ID y Client Secret a .env.local
6. En la app ir a Google Business → "Conectar con Google Business Profile" → autorizar

## Comandos útiles
```bash
# Build
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run build"

# Dev
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run dev"
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
