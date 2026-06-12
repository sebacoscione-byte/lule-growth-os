# Lule Growth OS

Sistema de adquisición de pacientes para la **Dra. Lucía Chahin**, cardióloga.

## Qué hace

- Captura leads desde Google Maps, Instagram, WhatsApp, landings y entrada manual
- Clasifica la intención del paciente con Claude (consulta cardiológica o ecocardiograma)
- Deriva al canal correcto: CIMEL Lanús (martes) o Swiss Medical Lomas (viernes)
- Hace seguimiento hasta que el paciente confirme que pidió turno
- Investiga fuentes recientes y genera contenido coordinado para Instagram y Google Business Profile
- Crea placas visuales descargables, guarda borradores y exige aprobacion humana
- Administra experimentos de crecimiento

**La app NO da turnos, NO reserva horarios, NO confirma disponibilidad.**

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui (componentes manuales)
- Supabase (Auth + PostgreSQL + RLS)
- Claude API (claude-sonnet-4-6) — clasificación y generación
- Vercel (deploy automático desde `main`)

## Setup

### 1. Variables de entorno

```bash
cp .env.example .env.local
# Completar con tus keys de Supabase y Anthropic
```

### 2. Base de datos Supabase

Ejecutar `docs/schema.sql` en el SQL Editor de Supabase. El script crea:
- Tablas: `leads`, `messages`, `growth_experiments`, `google_local_checklist`, `app_config`
- RLS policies (solo usuarios autenticados)
- Triggers para `updated_at`
- Seed data: configuración inicial, checklist y experimentos de ejemplo

### 3. Instalar y correr

```bash
npm install
npm run dev
```

### 4. Crear usuario admin en Supabase

En Supabase → Authentication → Users → Add user

## Estructura

```
src/
├── app/
│   ├── (app)/              # Rutas protegidas
│   │   ├── dashboard/      # KPIs y leads recientes
│   │   ├── leads/          # CRM + detalle + nuevo lead
│   │   ├── inbox/          # Conversaciones por lead
│   │   ├── google-local/   # Checklist y generadores Google
│   │   ├── contenido/instagram/  # Estudio editorial y aprobaciones
│   │   ├── landings/       # Panel de landing pages
│   │   ├── experimentos/   # Growth experiments
│   │   └── configuracion/  # Datos de la doctora
│   ├── (auth)/login/
│   ├── api/
│   └── landings/[slug]/    # Landing pages SEO públicas
├── lib/supabase/ · lib/claude.ts · lib/utils.ts
├── types/index.ts
└── components/ui/
```

## Landing pages públicas

| URL | Búsqueda objetivo |
|-----|-------------------|
| `/landings/dra-lucia-chahin` | dra lucia chahin |
| `/landings/cardiologa-lanus` | cardióloga en lanús |
| `/landings/cardiologa-lomas` | cardióloga en lomas |
| `/landings/ecocardiograma-lanus` | ecocardiograma en lanús |
| `/landings/ecocardiograma-lomas` | ecocardiograma en lomas |

## Guardrails médicos

La app nunca da diagnósticos, indica tratamientos ni reserva turnos.
Ante síntomas de alarma → deriva a guardia inmediatamente.

---

## Getting Started (original)

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
