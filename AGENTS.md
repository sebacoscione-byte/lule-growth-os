# Lule Growth OS — Agent Notes

## Contexto general
Sistema de adquisición de pacientes para la Dra. Lucía Chahin, cardióloga.
La app capta leads, los clasifica con IA, los deriva al canal correcto y hace seguimiento.
**No da turnos, no reserva horarios, no confirma disponibilidad.**

## Modo de trabajo esperado
- No pedir confirmación antes de actuar para pasos normales.
- Si una tarea deja cambios en el repo, cerrarla siempre con commit y push.
- Para tareas de 3+ pasos, crear o actualizar `docs/IN_PROGRESS.md`.
- Al cerrar una tarea, dejar actualizados los documentos afectados.

## Stack
- Next.js 14.2 (App Router) — usar `next.config.mjs`, no `.ts`
- TypeScript + Tailwind CSS + shadcn/ui (manual, sin CLI)
- Supabase (Auth + PostgreSQL)
- Claude API (claude-sonnet-4-6)
- Vercel (deploy automático desde `main`)

## Windows — Node.js
Node está en `C:\Program Files\nodejs\`. Ejecutar npm/node via PowerShell:
```
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm ..."
```

## Restricciones técnicas
- Supabase browser client sin generic type: `createBrowserClient()` (sin `<Database>`)
- `next.config.mjs` solamente (no `.ts`)
- shadcn/ui sin CLI — copiar componentes manualmente a `src/components/ui/`

## Reglas de commit
1. Correr build y tests antes de pushear.
2. Nunca commitear archivos que importan módulos sin commitear.
3. Verificar `git status` antes del push.
4. No usar `--no-verify`.

## Regla médica crítica
La app NUNCA da diagnósticos, terapéutica ni interpretación de estudios.
Ante síntomas de alarma → derivar a guardia. Consultas sensibles → escalar a humano.
