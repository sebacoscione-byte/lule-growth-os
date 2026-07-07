# Lule Growth OS — Agent Notes

## Contexto general
Sistema de adquisición de pacientes para la Dra. Lucía Chahin, cardióloga, en Argentina.
Capta leads desde landing pública y WhatsApp, los clasifica con IA, los deriva a una de
3 sedes médicas (CIMEL Lanús / Hospital Británico / Swiss Medical Lomas) y hace seguimiento
automático hasta que el paciente confirma que pidió turno. También gestiona contenido de
Instagram/Google Business.

**El sistema NO agenda turnos automáticamente, NO da diagnósticos, NO indica tratamientos.**
Solo capta, clasifica, deriva y hace seguimiento.

## Reglas obligatorias (todo agente: Claude Code, Codex, cualquier otro)
- **Nunca** modificar `.env`, `.env.local` ni ningún archivo con secrets.
- **Nunca** exponer tokens, API keys, Supabase `service_role`, ni credenciales de Meta,
  Google, Anthropic o Gemini — ni en código, ni en logs, ni en commits, ni en output.
- **Nunca** pushear directo a `main`. Trabajar siempre en rama + Pull Request (Vercel genera
  una URL de preview por PR). El usuario (Seba) hace vibe coding y no revisa código — el
  agente es responsable de verificar que el build compile y el preview cargue bien antes
  de mergear.
- **Mergear el PR sin pedir aprobación** si el build/tests pasan y el cambio NO toca lógica
  médica, webhooks de WhatsApp, cron jobs, RLS/auth, ni implica riesgo legal, de privacidad
  o de producción sensible. Mergear a `main` dispara el deploy automático de Vercel.
- **Si el cambio sí toca algo de lo anterior, o el resultado es ambiguo/riesgoso**: avisar
  con el link de preview y esperar el "dale" del usuario antes de mergear — no asumir.
- **No modificar lógica médica sin avisar antes** (clasificación de síntomas de alarma,
  guardrails, mensajes al paciente).
- Priorizar siempre: seguridad, privacidad, Supabase RLS, integridad de los webhooks de
  WhatsApp, y los límites del plan Vercel Hobby (2 cron jobs máximo, ver `vercel.json`).
- Antes de tocar webhooks de WhatsApp (`src/lib/whatsapp*.ts`, `/api/whatsapp/*`): revisar
  los tests existentes (`*.test.ts` junto a cada archivo) o proponer tests nuevos.
- Antes de tocar cron jobs de Vercel (`vercel.json`, `/api/cron/*`): revisar el impacto en
  los 2 cron jobs existentes (`publish-content`, `weekly-report`) — no hay lugar para un
  tercero en el plan Hobby.
- Toda mejora de growth/marketing debe mantener un tono médico responsable (nada de
  claims exagerados, urgencia falsa o lenguaje que suene a garantía de resultado).
- Todo cambio debe cerrar con: resumen técnico de qué se hizo + lista de archivos
  modificados.
- Si una tarea implica riesgo legal, médico, de privacidad o de producción: explicar los
  riesgos primero y pedir aprobación antes de ejecutar.

## Modo de trabajo esperado
- No pedir confirmación antes de actuar para pasos normales de bajo riesgo.
- Trabajar siempre en una rama (no en `main`) y cerrar con un Pull Request — nunca pushear
  directo a `main`.
- Mergear el PR sin pedir aprobación cuando build/tests pasan y el cambio no toca lo listado
  en "Reglas obligatorias" arriba (el usuario no revisa diffs). Si lo toca, avisar con el
  link de preview de Vercel y esperar confirmación antes de mergear.
- Para tareas de 3+ pasos, crear o actualizar `docs/IN_PROGRESS.md`.
- Al cerrar una tarea, dejar actualizados los documentos afectados (`CLAUDE.md`,
  `docs/BACKLOG.md`, etc. según corresponda).

## Stack
- Next.js 16.2 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui / Radix UI (instalado manualmente, sin CLI)
- Supabase (PostgreSQL + Auth) — RLS activo, usar `getServiceDb()` para `service_role`
- Vercel (deploy automático desde `main`, 2 cron jobs)
- WhatsApp Business Cloud API (bot conversacional)
- Instagram Graph API (Instagram Login) — publicación de posts/historias
- Google Analytics 4 + Google Places API (reseñas en landing pública)
- Jest (tests de lógica de negocio) — Playwright planeado a futuro para E2E

## Windows — Node.js
Node está en `C:\Program Files\nodejs\`. Ejecutar npm/node vía PowerShell:
```
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm ..."
```

## Comandos útiles (de `package.json`)
```bash
npm run dev      # servidor de desarrollo
npm run build    # build de producción (correr antes de todo PR)
npm run start    # levantar el build de producción
npm run lint      # eslint
npm test         # jest
npm run migrate  # migraciones de Supabase (requiere SUPABASE_DB_PASSWORD)
```
En Windows, anteponer el prefijo de PowerShell de la sección anterior a cualquiera de estos.

## Restricciones técnicas
- Supabase browser client sin generic type: `createBrowserClient()` (sin `<Database>`)
- `next.config.mjs` solamente (no `.ts`)
- shadcn/ui sin CLI — copiar componentes manualmente a `src/components/ui/`
- Cliente `service_role`: siempre `getServiceDb()` (`src/lib/supabase/service.ts`), nunca
  un cliente `@supabase/ssr` con cookies + `service_role` key juntos (bug histórico ya
  resuelto — ver `CLAUDE.md` para el detalle).

## Reglas de commit / PR
1. Leer `package.json` antes de asumir comandos de lint/test/build.
2. Correr `npm run build` y `npm test` antes de abrir el PR.
3. Nunca commitear archivos que importan módulos sin commitear.
4. No usar `--no-verify`.
5. Verificar `git status` antes de pushear la rama.
6. Trabajar en rama propia, abrir PR hacia `main` — nunca push directo a `main`.
7. El PR debe incluir resumen técnico + lista de archivos modificados.
8. Mergear sin pedir aprobación si build/tests pasan y no hay riesgo médico/legal/privacidad/
   producción; si lo hay, esperar confirmación del usuario antes de mergear (ver "Reglas
   obligatorias" arriba).

## Instrucciones específicas para Codex
- Antes de asumir qué comandos existen, leer `package.json` (scripts) — no asumir `yarn`
  ni comandos que no estén ahí.
- Antes de tocar lógica médica, webhooks de WhatsApp o cron jobs, seguir las reglas
  obligatorias de arriba (avisar / revisar tests / revisar límite de 2 crons).
- Verificar el trabajo corriendo `npm run lint`, `npm test` y `npm run build` antes de
  entregar el resultado como terminado.
- No instalar paquetes nuevos sin que estén justificados por la tarea pedida.
- Cerrar cada tarea con un resumen técnico + lista de archivos modificados, listo para
  usar como descripción de PR.

## Regla médica crítica
La app NUNCA da diagnósticos, NUNCA indica tratamientos ni interpreta estudios, y NUNCA
confirma disponibilidad ni reserva turnos. Ante síntomas de alarma → derivar a guardia
inmediatamente. Consultas sensibles → escalar a humano.
