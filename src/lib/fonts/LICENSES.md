# Licencias de las tipografías bundleadas

Usadas por `content-plate.ts` (placas de Instagram) y `video-caption.ts` (texto sobre video/reels)
vía `drawtext` de ffmpeg — no se puede usar `next/font` ahí, necesita un archivo `.ttf` real en disco.

| Archivo | Familia | Licencia | Origen |
|---|---|---|---|
| `DejaVuSans-Bold.ttf` | DejaVu Sans | Bitstream Vera / DejaVu (libre) | https://dejavu-fonts.github.io/License.html |
| `Fraunces-Bold.ttf` | Fraunces (peso 700) | SIL Open Font License 1.1 | Google Fonts — mismo family que usa la landing pública vía `next/font/google` (ver `src/app/layout.tsx`) |
| `Inter-Regular.ttf` | Inter (peso 400) | SIL Open Font License 1.1 | Google Fonts — ídem |
| `Inter-Bold.ttf` | Inter (peso 700) | SIL Open Font License 1.1 | Google Fonts — ídem |

Fraunces e Inter se bajaron el 2026-07-30 directo de `fonts.gstatic.com` (mismos archivos que sirve
Google Fonts, formato TTF real — necesario porque `drawtext`/freetype no soporta WOFF2) para que la
placa de Instagram (panel de texto + foto) comparta la misma identidad tipográfica que la landing
pública (`ink`/`paper`/`cardiac`, ver `src/app/globals.css`), en vez de inventar una fuente nueva.
Libres de usar y redistribuir sin atribución obligatoria (SIL OFL permite embeber la fuente en un
producto).
