---
name: run-lule-growth-os
description: Run, start, launch, build, or screenshot Lule Growth OS — the Next.js patient acquisition app for Dra. Lucía Chahin. Use to verify changes, confirm a feature works, or take screenshots.
---

Lule Growth OS is a Next.js 16.2.9 (App Router + Turbopack) web app running on `http://localhost:3000`. On Windows, Node.js is **not** on PATH by default — every command must set it explicitly. The interaction harness is Edge headless (`msedge.exe --headless`).

## Prerequisites

- Node.js at `C:\Program Files\nodejs\` (already installed)
- `.env.local` with Supabase + AI keys (app boots without it but auth won't work)
- Microsoft Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (for screenshots)

## Build

```powershell
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run build"
```

## Run (agent path — headless screenshot)

**Step 1: Start dev server in background**

```powershell
Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command `"cd 'c:\Users\sebac\Desktop\app lule'; `$env:Path = 'C:\Program Files\nodejs;' + `$env:Path; npm run dev 2>&1 | Tee-Object -FilePath 'c:\Users\sebac\Desktop\app lule\dev-server.log'`"" -WindowStyle Hidden
```

**Step 2: Wait for ready (dev server starts in ~1s)**

```powershell
Start-Sleep -Seconds 8
Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 5 -UseBasicParsing | Select-Object StatusCode
```

Expected: `StatusCode: 200`

**Step 3: Take a screenshot**

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --screenshot="c:\Users\sebac\Desktop\app lule\.claude\skills\run-lule-growth-os\screenshot-login.png" --window-size=1280,800 "http://localhost:3000/login"
Start-Sleep -Seconds 3
```

Screenshots land in `.claude/skills/run-lule-growth-os/`. Read them with the Read tool to visually verify.

**Step 4: Check multiple routes**

```powershell
$routes = @("/", "/login", "/leads", "/dashboard", "/inbox", "/contenido/instagram", "/google-local")
foreach ($r in $routes) {
  try {
    $res = Invoke-WebRequest -Uri "http://localhost:3000$r" -TimeoutSec 5 -UseBasicParsing
    Write-Output "$r → $($res.StatusCode)"
  } catch { Write-Output "$r → Error: $($_.Exception.Message)" }
}
```

Expected: all return 200 (auth-protected routes redirect internally to `/login` but still return 200).

## Run (human path)

```powershell
powershell.exe -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\nodejs;' + [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'Process'); npm run dev"
```

Opens `http://localhost:3000` in browser. Ctrl-C to stop. Useless headless.

## Gotchas

- **Node.js not on PATH in bash/PowerShell sessions**: Always prepend `C:\Program Files\nodejs;` to `$env:Path` before any `npm` or `node` command, or use the full PowerShell invocation from CLAUDE.md.
- **middleware.ts deprecation warning**: Next.js 16 expects `src/proxy.ts` instead of `src/middleware.ts`. The app still works, but the warning appears on every start: `The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Root `/` redirects to `/login`**: The middleware intercepts unauthenticated requests with a 307. This is correct — don't mistake it for a bug.
- **`npm run dev` never returns**: It's a long-running process. Always launch it in a background process (`Start-Process`) or in a separate PowerShell window — never `&&`-chain it.
- **Edge screenshot needs 3s sleep**: Edge `--headless --screenshot` exits before the page fully renders. Add `Start-Sleep -Seconds 3` after the command.
- **Protected routes need Supabase**: Without `.env.local`, the app loads the login page but logging in fails. Public pages (`/landings/[slug]`, `/login`) work without credentials.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm : The term 'npm' is not recognized` | Add Node to path: `$env:Path = "C:\Program Files\nodejs;" + $env:Path` |
| `EADDRINUSE: address already in use :::3000` | Another Next.js instance running. `Stop-Process -Name "node" -Force` |
| Screenshot is blank white | Page not loaded yet — increase sleep to 5s; verify server is running first |
| `Invoke-WebRequest` times out | Dev server not started yet — wait another 5s and retry |
| Build fails on type errors | Run `npx tsc --noEmit` to see TypeScript errors before fixing |
