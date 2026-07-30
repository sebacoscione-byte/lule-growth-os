import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"

const execFileAsync = promisify(execFile)

// Paleta de marca del sitio publico (ver src/app/globals.css) -- se reusa aca en vez de inventar
// colores nuevos, para que el feed de Instagram y la landing compartan una sola identidad visual.
const COLOR_PAPER = "0xF6F4EE"
const COLOR_INK = "0x16242C"
const COLOR_INK_SOFT = "0x3D505C"
const COLOR_CARDIAC = "0xB23B34"

// Fraunces (display serif) + Inter (sans) son las mismas familias que usa la landing publica
// (next/font/google alla, TTF real bundleado aca -- drawtext de ffmpeg no puede usar next/font).
// Bajadas desde Google Fonts (SIL Open Font License, libre y redistribuible) -- ver LICENSES.md en
// este mismo directorio. Co-ubicadas junto a DejaVuSans-Bold.ttf para que el file tracing de
// Next.js las incluya en el bundle de la funcion (ver next.config.mjs).
const FONT_DISPLAY = join(__dirname, "fonts", "Fraunces-Bold.ttf")
const FONT_SANS = join(__dirname, "fonts", "Inter-Regular.ttf")
const FONT_SANS_BOLD = join(__dirname, "fonts", "Inter-Bold.ttf")

const BRAND_NAME = "DRA. LUCÍA CHAHÍN"
const BRAND_SPECIALTY = "C A R D I O L O G Í A"

/** ffmpeg trata ":" como separador de opciones dentro del filtergraph -- mismo gotcha que
 * video-caption.ts, ver ese archivo para el detalle completo (rutas de Windows con unidad+backslash). */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:")
}

// drawtext no hace word-wrap ni conoce el ancho real de cada letra -- se corta a mano por palabra
// entera segun una estimacion de caracteres por linea (ver HEADLINE_CHAR_RATIO/SUBTITLE_CHAR_RATIO),
// nunca a mitad de una palabra.
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

const DIMENSIONS: Record<"post" | "historia" | "carrusel" | "reel", { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  carrusel: { width: 1080, height: 1350 },
  historia: { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
}

const PANEL_WIDTH_RATIO = 0.52
const PANEL_PADDING_X = 64
const PANEL_RIGHT_MARGIN = 30
// Ancho promedio por caracter (en unidades de fontsize/em), calibrado a mano contra el rendering
// real de cada tipografia -- ver la sesion 2026-07-30 que armo esta funcion: un valor optimista
// hacia que el titular pisara la foto ("SINTOMAS DE ALARMA" cruzaba el limite del panel). Estos dos
// valores son deliberadamente conservadores (de mas, no de menos) para garantizar que el texto
// nunca invada el area de la foto, a costa de wrappear a una linea mas de lo estrictamente necesario
// en algunos casos.
const HEADLINE_CHAR_RATIO = 0.62 // Fraunces Bold, todo en mayusculas
const SUBTITLE_CHAR_RATIO = 0.52 // Inter Regular, mezcla de mayusculas/minusculas
const HEADLINE_FONT_SIZE = 50
const SUBTITLE_FONT_SIZE = 34

/**
 * Compone la placa final de Instagram: el modelo de imagen (ver generateContentVisual en ai.ts)
 * genera SOLO la foto/escena, sin ningun texto -- el titular, subtitulo, nombre y especialidad los
 * dibuja esta funcion por edicion real (ffmpeg drawtext), igual que burnVideoBrief hace con los
 * videos de reels. Garantiza ortografia/acentos perfectos siempre, a diferencia de pedirle el texto
 * al modelo de imagen (bug real documentado en docs/BACKLOG.md, 2026-07-30: el modelo llego a
 * inventar una tercera linea deforme, o a comerse letras de "ALARMA"). Reusa la misma paleta y
 * tipografia que la landing publica (ink/paper/cardiac, Fraunces+Inter) para que el feed de
 * Instagram y el sitio compartan una sola identidad visual, en vez de inventar un estilo aparte.
 *
 * Layout: panel de texto a la izquierda (paper) + foto a la derecha (bleed completo), con una barra
 * de acento al pie a modo de firma de marca simplificada. Los iconos/onda decorativos de la
 * referencia (ver backlog) quedan pendientes -- requieren assets vectoriales propios que todavia no
 * existen; este layout ya es sustancialmente mas confiable y prolijo que el full-bleed anterior.
 */
export async function composeContentPlate(input: {
  photoBuffer: Buffer
  headline: string
  subtitle: string
  format: "reel" | "historia" | "carrusel" | "post"
}): Promise<Buffer> {
  const { width, height } = DIMENSIONS[input.format]
  const panelWidth = Math.round(width * PANEL_WIDTH_RATIO)
  const photoWidth = width - panelWidth
  const availableWidth = panelWidth - PANEL_PADDING_X - PANEL_RIGHT_MARGIN

  const headlineCharsPerLine = Math.max(6, Math.floor(availableWidth / (HEADLINE_FONT_SIZE * HEADLINE_CHAR_RATIO)))
  const subtitleCharsPerLine = Math.max(10, Math.floor(availableWidth / (SUBTITLE_FONT_SIZE * SUBTITLE_CHAR_RATIO)))

  const headlineLines = wrapText(input.headline.toUpperCase(), headlineCharsPerLine)
  const subtitleLines = wrapText(input.subtitle, subtitleCharsPerLine)
  // La ultima linea del titular se destaca en color cardiac (mismo patron que la referencia que
  // motivo este rediseño) -- si el titular entra en una sola linea, queda entera en ink, sin acento.
  const headlineMainLines = headlineLines.length >= 2 ? headlineLines.slice(0, -1) : headlineLines
  const headlineAccentLine = headlineLines.length >= 2 ? headlineLines[headlineLines.length - 1] : ""

  const headlineLineHeight = HEADLINE_FONT_SIZE * 1.14
  const subtitleLineHeight = SUBTITLE_FONT_SIZE * 1.4
  const dividerGap = 26
  const dividerHeight = 4
  const subtitleGap = 26
  const brandGap = 50
  const brandBlockHeight = 30 + 34 // nombre + especialidad, con su propio espaciado

  const headlineBlockHeight = headlineLines.length * headlineLineHeight
  const subtitleBlockHeight = subtitleLines.length * subtitleLineHeight
  const totalBlockHeight = headlineBlockHeight + dividerGap + dividerHeight + subtitleGap +
    subtitleBlockHeight + brandGap + brandBlockHeight
  const startY = Math.max(90, Math.round((height - totalBlockHeight) / 2))

  const headlineY = startY
  const headlineAccentY = Math.round(headlineY + headlineMainLines.length * headlineLineHeight)
  const dividerY = Math.round(headlineY + headlineBlockHeight + dividerGap)
  const subtitleY = Math.round(dividerY + dividerHeight + subtitleGap)
  const brandY = Math.round(subtitleY + subtitleBlockHeight + brandGap)
  const specialtyY = Math.round(brandY + 38)

  const workDir = await mkdtemp(join(tmpdir(), "lule-content-plate-"))
  try {
    const photoPath = join(workDir, "photo.img")
    await writeFile(photoPath, input.photoBuffer)

    const headlineTextPath = join(workDir, "headline.txt")
    const headlineAccentTextPath = join(workDir, "headline-accent.txt")
    const subtitleTextPath = join(workDir, "subtitle.txt")
    const brandTextPath = join(workDir, "brand.txt")
    const specialtyTextPath = join(workDir, "specialty.txt")
    await writeFile(headlineTextPath, headlineMainLines.join("\n"), "utf-8")
    await writeFile(headlineAccentTextPath, headlineAccentLine, "utf-8")
    await writeFile(subtitleTextPath, subtitleLines.join("\n"), "utf-8")
    await writeFile(brandTextPath, BRAND_NAME, "utf-8")
    await writeFile(specialtyTextPath, BRAND_SPECIALTY, "utf-8")

    const fraunces = escapeFilterPath(FONT_DISPLAY)
    const interRegular = escapeFilterPath(FONT_SANS)
    const interBold = escapeFilterPath(FONT_SANS_BOLD)

    const filters = [
      // Foto: se escala hasta cubrir el hueco de la derecha y se recorta desde el borde derecho de
      // la imagen (in_w-out_w) -- no centrado -- porque la direccion visual le pide al modelo dejar
      // espacio negativo a la izquierda y al sujeto en los dos tercios derechos (ver generateContentVisual).
      `[1:v]scale=${photoWidth}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${photoWidth}:${height}:in_w-out_w:(in_h-out_h)/2[photo]`,
      `[0:v][photo]overlay=x=${panelWidth}:y=0[withphoto]`,
      `[withphoto]drawbox=x=0:y=${height - 22}:w=${width}:h=22:color=${COLOR_CARDIAC}@1:t=fill[withbar]`,
      `[withbar]drawtext=fontfile='${fraunces}':textfile='${escapeFilterPath(headlineTextPath)}':` +
        `fontsize=${HEADLINE_FONT_SIZE}:fontcolor=${COLOR_INK}:line_spacing=${Math.round(HEADLINE_FONT_SIZE * 0.14)}:` +
        `x=${PANEL_PADDING_X}:y=${headlineY}[withheadline0]`,
      `[withheadline0]drawtext=fontfile='${fraunces}':textfile='${escapeFilterPath(headlineAccentTextPath)}':` +
        `fontsize=${HEADLINE_FONT_SIZE}:fontcolor=${COLOR_CARDIAC}:x=${PANEL_PADDING_X}:y=${headlineAccentY}[withheadline]`,
      `[withheadline]drawbox=x=${PANEL_PADDING_X}:y=${dividerY}:w=110:h=${dividerHeight}:color=${COLOR_CARDIAC}@1:t=fill[withdivider]`,
      `[withdivider]drawtext=fontfile='${interRegular}':textfile='${escapeFilterPath(subtitleTextPath)}':` +
        `fontsize=${SUBTITLE_FONT_SIZE}:fontcolor=${COLOR_INK_SOFT}:line_spacing=${Math.round(SUBTITLE_FONT_SIZE * 0.4)}:` +
        `x=${PANEL_PADDING_X}:y=${subtitleY}[withsubtitle]`,
      `[withsubtitle]drawtext=fontfile='${interBold}':textfile='${escapeFilterPath(brandTextPath)}':` +
        `fontsize=30:fontcolor=${COLOR_INK}:x=${PANEL_PADDING_X}:y=${brandY}[withbrand]`,
      `[withbrand]drawtext=fontfile='${interBold}':textfile='${escapeFilterPath(specialtyTextPath)}':` +
        `fontsize=19:fontcolor=${COLOR_CARDIAC}:x=${PANEL_PADDING_X}:y=${specialtyY}`,
    ].join(";")

    const outputPath = join(workDir, "output.png")
    await execFileAsync(ffmpegInstaller.path, [
      "-y",
      "-f", "lavfi", "-i", `color=c=${COLOR_PAPER}:s=${width}x${height}`,
      "-i", photoPath,
      "-filter_complex", filters,
      "-frames:v", "1",
      outputPath,
    ])

    return await readFile(outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
