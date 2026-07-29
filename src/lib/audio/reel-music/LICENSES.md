# Música de fondo para reels — Pixabay Music

Mini-biblioteca de 4 pistas usadas por `addBackgroundMusic()` (`src/lib/video-caption.ts`) para
reemplazar el audio ambiente que genera Veo en los reels de IA. Todas son de **Pixabay Music**,
bajo la [Pixabay Content License](https://pixabay.com/service/license-summary/): uso comercial
permitido, sin atribución obligatoria.

## ⚠️ Pendiente real: los archivos `.mp3` todavía no están acá

Pixabay protege el botón de descarga con un desafío de Cloudflare Turnstile (CAPTCHA) que un
script no puede resolver — bajarlos requiere un navegador real, una sola vez. `addBackgroundMusic()`
ya está preparado para esto: si no encuentra ningún archivo en esta carpeta, sigue de largo sin
música (fail-open), no rompe nada.

**Para activar la música**, por cada fila de la tabla: abrí el link de Pixabay → botón
"Free download" → guardá el archivo con el nombre exacto de la columna "Archivo esperado" en esta
misma carpeta (`src/lib/audio/reel-music/`).

## Por qué estas 4 y no otras

Cada pista se verificó a mano (visitando la página real) para confirmar que **no** tiene el ícono
de "Content ID Registered" — Pixabay permite subir una pista con licencia libre y, aparte,
registrarla en el Content ID de YouTube/Meta (a veces sin querer, a veces por colisión de loops
compartidos entre compositores). Si se usa una pista con ese ícono, Instagram puede silenciar o
bloquear el reel después de publicado, aunque la licencia esté en regla — ver hilo de soporte de
YouTube citado más abajo. Antes de sumar una pista nueva a esta lista, repetir esa verificación
manual en la página del track.

## Pistas verificadas (2026-07-28)

| Archivo esperado | Título | Página de Pixabay |
|---|---|---|
| `peaceful-morning-378816.mp3` | Peaceful Morning | https://pixabay.com/music/acoustic-group-peaceful-morning-378816/ |
| `warm-acoustic-guitar-232912.mp3` | Warm Acoustic Guitar | https://pixabay.com/music/acoustic-group-warm-acoustic-guitar-232912/ |
| `gentle-ambient-atmosphere-332292.mp3` | Gentle Ambient Atmosphere | https://pixabay.com/music/ambient-gentle-ambient-atmosphere-332292/ |
| `calm-classical-piano-291012.mp3` | Calm Classical Piano | https://pixabay.com/music/modern-classical-calm-classical-piano-291012/ |

Todas instrumentales (sin voz/letra), tono cálido y calmo — coherente con el resto de la cuenta
(ver `VIDEO_PROMPT_RULES`/design system: nunca dramático, nunca rosa/lujo, cercano y profesional).

## Referencia sobre el riesgo de Content ID

- [Dispute of False Copyright Claim – Music Used Is Copyright-Free from Pixabay (YouTube Community)](https://support.google.com/youtube/thread/355735754/dispute-of-false-copyright-claim-%E2%80%93-music-used-is-copyright-free-from-pixabay)
- [How to clear a YouTube Content ID claim with a Pixabay License Certificate (Pixabay Blog)](https://pixabay.com/blog/posts/how-to-clear-a-youtube-content-id-claim-with-a-pix-190/)

Si algún día una publicación queda silenciada igual pese a este filtro, Pixabay permite descargar
un "certificado de licencia" desde la página del track para disputar el reclamo en Meta/Instagram.
