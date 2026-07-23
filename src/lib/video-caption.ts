import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import ffprobeInstaller from "@ffprobe-installer/ffprobe"
import type { ContentScene } from "@/types"

const execFileAsync = promisify(execFile)

// DejaVu Sans Bold: fuente estatica (no variable) con buena cobertura de acentos/ñ en español,
// eleccion estandar para drawtext de ffmpeg en entornos headless (sin fontconfig del sistema).
// Licencia Bitstream Vera / DejaVu (libre, redistribuible), ver
// https://dejavu-fonts.github.io/License.html. Co-ubicada en este mismo directorio para que el
// file tracing de Next.js la incluya en el bundle de la funcion (ver next.config.mjs).
const FONT_PATH = join(__dirname, "fonts", "DejaVuSans-Bold.ttf")

// Mismo tope que el editor de guion (ver REEL_SCENE_RULES en ai.ts).
const MAX_SCENES = 6

/** ffmpeg trata ":" como separador de opciones y "\" como caracter de escape dentro del filtergraph
 * -- las rutas de Windows (unidad + backslashes) rompen el parser si no se normalizan. En Linux
 * (produccion) esto es un no-op (las rutas no tienen ":" ni "\"). */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:")
}

// drawtext no hace word-wrap solo -- un onScreenText de 8-10 palabras a este tamaño de fuente se
// corta contra los bordes del video (720px de ancho, formato vertical). Se ajusta a mano, cortando
// por palabra entera, nunca a mitad de una palabra. ~19 caracteres/linea es un margen conservador
// para DejaVu Sans Bold a fontsize 44 en un video de 720px de ancho.
const FONT_SIZE = 44
const MAX_CHARS_PER_LINE = 19

function wrapCaptionText(text: string, maxCharsPerLine: number = MAX_CHARS_PER_LINE): string {
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
  return lines.join("\n")
}

async function getDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
  ])
  const seconds = Number.parseFloat(stdout.trim())
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 8
}

/**
 * Quema el texto en pantalla del guion (item.scenes) sobre un video ya generado con IA o subido a
 * mano, con ffmpeg. El texto de cada escena se pasa via un archivo aparte (textfile=), no inline
 * (text=) -- evita tener que escapar tildes/eñes/comillas/dos puntos del texto en español dentro del
 * filtergraph, que es appropiadamente delicado de hacer bien a mano.
 *
 * El guion (REEL_SCENE_RULES) esta pensado para un reel filmado a mano de hasta 25s; un clip generado
 * con Veo dura como maximo 8s (una sola generacion). Por eso se detecta la duracion real con ffprobe
 * y solo se queman las escenas cuyo "from" cae dentro de esa duracion -- las que no entran
 * simplemente no se muestran, en vez de romper el video o desbordar el clip.
 */
export async function burnCaptionsOntoVideo(input: {
  videoBuffer: Buffer
  scenes: ContentScene[]
}): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "lule-video-caption-"))
  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")
    await writeFile(inputPath, input.videoBuffer)

    const durationSeconds = await getDurationSeconds(inputPath)

    const usableScenes = input.scenes
      .filter(scene => scene.from < durationSeconds && scene.onScreenText.trim())
      .slice(0, MAX_SCENES)
    if (usableScenes.length === 0) return input.videoBuffer

    const fontPath = escapeFilterPath(FONT_PATH)
    const drawtextFilters = await Promise.all(usableScenes.map(async (scene, index) => {
      const textPath = join(workDir, `scene-${index}.txt`)
      await writeFile(textPath, wrapCaptionText(scene.onScreenText), "utf-8")
      const to = Math.max(scene.from + 0.5, Math.min(scene.to, durationSeconds))
      const escapedTextPath = escapeFilterPath(textPath)
      return `drawtext=fontfile='${fontPath}':textfile='${escapedTextPath}':fontsize=${FONT_SIZE}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=h-240:line_spacing=8:enable='between(t\\,${scene.from}\\,${to})'`
    }))

    await execFileAsync(ffmpegInstaller.path, [
      "-y", "-i", inputPath,
      "-vf", drawtextFilters.join(","),
      "-codec:a", "copy",
      outputPath,
    ])

    return await readFile(outputPath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
