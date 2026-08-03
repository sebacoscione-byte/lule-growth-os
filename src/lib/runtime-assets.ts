import { join } from "node:path"

/**
 * Resuelve assets trazados por Next desde el root real de la función.
 *
 * No usar `__dirname`: Turbopack lo evalúa al compilar y puede dejar rutas virtuales como
 * `/ROOT/src/lib`, que no existen dentro de la función de Vercel aunque el file tracing haya
 * incluido correctamente el archivo bajo `src/lib`.
 */
export const CONTENT_PLATE_FONT_DISPLAY = join(
  process.cwd(), "src", "lib", "fonts", "Fraunces-Bold.ttf"
)
export const CONTENT_PLATE_FONT_SANS = join(
  process.cwd(), "src", "lib", "fonts", "Inter-Regular.ttf"
)
export const CONTENT_PLATE_FONT_SANS_BOLD = join(
  process.cwd(), "src", "lib", "fonts", "Inter-Bold.ttf"
)
export const VIDEO_CAPTION_FONT = join(
  process.cwd(), "src", "lib", "fonts", "DejaVuSans-Bold.ttf"
)
export const REEL_MUSIC_DIR = join(process.cwd(), "src", "lib", "audio", "reel-music")
